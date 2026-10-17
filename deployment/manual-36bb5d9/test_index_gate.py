"""Offline safety and readiness tests for the additive Firestore index gate.

Run from this directory with ``python3 -m unittest -v test_index_gate``.
All transport, timing, and Firestore state are local fakes.
"""

import copy
import io
import json
import unittest
import urllib.error

import index_gate


PROJECT = "repaido"
DATABASE = "(default)"
DELTA = {
    "collectionGroup": "ops_saved_alert_checks",
    "queryScope": "COLLECTION",
    "fields": [
        {"fieldPath": "active", "order": "ASCENDING"},
        {"fieldPath": "next_check_at", "order": "ASCENDING"},
        {"fieldPath": "__name__", "order": "ASCENDING"},
    ],
}
BASELINE = {
    "collectionGroup": "existing_items",
    "queryScope": "COLLECTION",
    "fields": [
        {"fieldPath": "owner", "order": "ASCENDING"},
        {"fieldPath": "created_at", "order": "DESCENDING"},
    ],
}


def remote_index(spec=DELTA, state="READY", index_id="index-123"):
    """Firestore Index resources do not contain collectionGroup explicitly."""
    return {
        "name": (
            f"projects/{PROJECT}/databases/{DATABASE}/collectionGroups/"
            f"{spec['collectionGroup']}/indexes/{index_id}"
        ),
        "queryScope": spec["queryScope"],
        "fields": copy.deepcopy(spec["fields"]),
        "state": state,
    }


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        if seconds < 0:
            raise AssertionError("The gate attempted a negative sleep")
        self.sleeps.append(seconds)
        self.now += seconds


class FakeAPI:
    project = PROJECT
    database = DATABASE

    def __init__(self, snapshots=None, create_error=None, create_result=None):
        # Per collection, consume snapshots and then repeat the last one.
        self.snapshots = copy.deepcopy(snapshots or {})
        self.reads = []
        self.creates = []
        self.create_error = create_error
        self.create_result = create_result

    def list_indexes(self, collection):
        self.reads.append(collection)
        versions = self.snapshots.get(collection, [[]])
        result = versions[0]
        if len(versions) > 1:
            versions.pop(0)
        return copy.deepcopy(result)

    def create_index(self, spec):
        self.creates.append(copy.deepcopy(spec))
        if self.create_error is not None:
            raise self.create_error
        return copy.deepcopy(self.create_result or {"name": "operations/fake"})


class FakeResponse(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(json.dumps(body).encode("utf-8"))
        self.status = status
        self.headers = {"Content-Type": "application/json"}

    def getcode(self):
        return self.status


class NormalizationTests(unittest.TestCase):
    def test_implicit_document_name_uses_last_order_direction(self):
        for direction in ("ASCENDING", "DESCENDING"):
            with self.subTest(direction=direction):
                implicit = copy.deepcopy(BASELINE)
                implicit["fields"][-1]["order"] = direction
                explicit = copy.deepcopy(implicit)
                explicit["fields"].append(
                    {"fieldPath": "__name__", "order": direction}
                )
                self.assertEqual(
                    index_gate.normalized_spec(implicit),
                    index_gate.normalized_spec(explicit),
                )
                # Normalization must not mutate caller-owned definitions.
                self.assertEqual(len(implicit["fields"]), 2)

    def test_explicit_document_direction_remains_semantically_significant(self):
        different = copy.deepcopy(DELTA)
        different["fields"][-1]["order"] = "DESCENDING"
        self.assertNotEqual(
            index_gate.normalized_spec(DELTA),
            index_gate.normalized_spec(different),
        )

    def test_field_order_remains_semantically_significant(self):
        different = copy.deepcopy(DELTA)
        different["fields"][0:2] = reversed(different["fields"][0:2])
        self.assertNotEqual(
            index_gate.normalized_spec(DELTA),
            index_gate.normalized_spec(different),
        )


class EnsureIndexesTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()

    def ensure(self, api, desired=None, **kwargs):
        options = {
            "timeout": 3,
            "poll_seconds": 1,
            "clock": self.clock.monotonic,
            "sleep": self.clock.sleep,
        }
        options.update(kwargs)
        return index_gate.ensure_indexes(
            api, copy.deepcopy(desired if desired is not None else [DELTA]),
            **options,
        )

    def approved_delta(self):
        return {index_gate.normalized_spec(DELTA)}

    def test_ready_exact_match_reused_with_receipt_and_no_writes(self):
        ready = remote_index()
        api = FakeAPI({DELTA["collectionGroup"]: [[ready]]})
        receipt = self.ensure(api)
        self.assertEqual(api.creates, [])
        self.assertEqual(receipt["project"], PROJECT)
        self.assertEqual(receipt["database"], DATABASE)
        self.assertEqual(len(receipt["indexes"]), 1)
        entry = receipt["indexes"][0]
        self.assertEqual(entry["name"], ready["name"])
        self.assertEqual(entry["state"], "READY")
        self.assertEqual(
            index_gate.normalized_spec(entry["definition"]),
            index_gate.normalized_spec(DELTA),
        )

    def test_existing_building_index_is_polled_until_ready_without_creation(self):
        api = FakeAPI({DELTA["collectionGroup"]: [
            [remote_index(state="CREATING")], [remote_index()],
        ]})
        receipt = self.ensure(api)
        self.assertEqual(receipt["indexes"][0]["state"], "READY")
        self.assertEqual(api.creates, [])
        self.assertGreaterEqual(len(api.reads), 2)
        self.assertTrue(self.clock.sleeps)

    def test_only_approved_delta_is_added_and_all_desired_indexes_are_ready(self):
        api = FakeAPI({
            BASELINE["collectionGroup"]: [[remote_index(BASELINE)]],
            DELTA["collectionGroup"]: [[], [remote_index()]],
        })
        receipt = self.ensure(
            api, [BASELINE, DELTA], approved_missing=self.approved_delta()
        )
        self.assertEqual(len(api.creates), 1)
        self.assertEqual(
            index_gate.normalized_spec(api.creates[0]),
            index_gate.normalized_spec(DELTA),
        )
        self.assertEqual(len(receipt["indexes"]), 2)
        self.assertTrue(all(x["state"] == "READY" for x in receipt["indexes"]))

    def test_check_only_rejects_existing_unready_index_without_writes(self):
        api = FakeAPI({DELTA["collectionGroup"]: [[remote_index(state="CREATING")]]})
        with self.assertRaises(index_gate.GateError):
            self.ensure(api, check_only=True)
        self.assertEqual(api.creates, [])

    def test_check_only_never_creates_even_an_approved_missing_delta(self):
        api = FakeAPI()
        with self.assertRaises(index_gate.GateError):
            self.ensure(api, check_only=True, approved_missing=self.approved_delta())
        self.assertEqual(api.creates, [])

    def test_unexpected_missing_baseline_stops_before_any_creation(self):
        api = FakeAPI()
        with self.assertRaises(index_gate.GateError):
            # Approved delta first detects a gate that mutates before preflight.
            self.ensure(api, [DELTA, BASELINE], approved_missing=self.approved_delta())
        self.assertEqual(api.creates, [])

    def test_absent_explicit_approval_refuses_creation(self):
        api = FakeAPI()
        with self.assertRaises(index_gate.GateError):
            self.ensure(api, approved_missing=None)
        self.assertEqual(api.creates, [])

    def test_duplicate_create_race_rereads_and_waits_for_exact_ready_index(self):
        api = FakeAPI(
            {DELTA["collectionGroup"]: [
                [], [remote_index(state="CREATING")], [remote_index()],
            ]},
            create_error=index_gate.AlreadyExists("HTTP 409"),
        )
        receipt = self.ensure(api, approved_missing=self.approved_delta())
        self.assertEqual(len(api.creates), 1)
        self.assertGreaterEqual(len(api.reads), 3)
        self.assertEqual(receipt["indexes"][0]["state"], "READY")

    def test_different_existing_definition_does_not_satisfy_requirement(self):
        different = copy.deepcopy(DELTA)
        different["fields"][1]["order"] = "DESCENDING"
        api = FakeAPI({DELTA["collectionGroup"]: [[remote_index(different)]]})
        with self.assertRaises(index_gate.GateError):
            self.ensure(api)
        self.assertEqual(api.creates, [])

    def test_valid_unrelated_array_and_vector_indexes_do_not_block_ready_match(self):
        unrelated_fields = [
            [
                {"fieldPath": "tags", "arrayConfig": "CONTAINS"},
                {"fieldPath": "created_at", "order": "DESCENDING"},
                {"fieldPath": "__name__", "order": "DESCENDING"},
            ],
            [
                {"fieldPath": "__name__", "order": "ASCENDING"},
                {"fieldPath": "embedding", "vectorConfig": {"dimension": 3, "flat": {}}},
            ],
        ]
        for fields in unrelated_fields:
            with self.subTest(fields=fields):
                unrelated = remote_index(index_id="unrelated-index")
                unrelated["fields"] = copy.deepcopy(fields)
                api = FakeAPI({DELTA["collectionGroup"]: [[unrelated, remote_index()]]})
                receipt = self.ensure(api)
                self.assertEqual(len(receipt["indexes"]), 1)
                self.assertEqual(receipt["indexes"][0]["name"], remote_index()["name"])
                self.assertEqual(api.creates, [])

    def test_malformed_unrelated_vector_index_is_rejected(self):
        invalid_configs = [
            {"dimension": 0, "flat": {}},
            {"dimension": -1, "flat": {}},
            {"dimension": "3", "flat": {}},
            {"dimension": True, "flat": {}},
            {"dimension": 3, "flat": []},
            {"dimension": 3},
        ]
        for config in invalid_configs:
            with self.subTest(config=config):
                malformed = remote_index(index_id="unrelated-index")
                malformed["fields"] = [
                    {"fieldPath": "__name__", "order": "ASCENDING"},
                    {"fieldPath": "embedding", "vectorConfig": config},
                ]
                api = FakeAPI({DELTA["collectionGroup"]: [[malformed, remote_index()]]})
                with self.assertRaises(index_gate.GateError):
                    self.ensure(api)
                self.assertEqual(api.creates, [])

    def test_create_response_with_wrong_definition_cannot_pass_gate(self):
        different = copy.deepcopy(DELTA)
        different["fields"][1]["fieldPath"] = "unrelated_field"
        wrong_index = remote_index(different)
        api = FakeAPI(
            {DELTA["collectionGroup"]: [[], [wrong_index]]},
            create_result=wrong_index,
        )
        with self.assertRaises(index_gate.GateError):
            self.ensure(api, approved_missing=self.approved_delta())
        self.assertEqual(len(api.creates), 1)

    def test_index_resource_must_belong_to_expected_project_database_and_group(self):
        valid = remote_index()
        invalid_names = [
            valid["name"].replace("projects/repaido/", "projects/another-project/"),
            valid["name"].replace("databases/(default)/", "databases/another-db/"),
            valid["name"].replace("/ops_saved_alert_checks/", "/another-group/"),
            "index-123",
            valid["name"].rsplit("/", 1)[0] + "/",
        ]
        for name in invalid_names:
            with self.subTest(name=name):
                invalid = copy.deepcopy(valid)
                invalid["name"] = name
                api = FakeAPI({DELTA["collectionGroup"]: [[invalid]]})
                with self.assertRaises(index_gate.GateError):
                    self.ensure(api, approved_missing=self.approved_delta())
                self.assertEqual(api.creates, [])

    def test_malformed_existing_index_is_rejected_before_any_write(self):
        missing_name = remote_index()
        del missing_name["name"]
        missing_state = remote_index()
        del missing_state["state"]
        malformed_fields = remote_index()
        malformed_fields["fields"] = "not-an-array"
        malformed_direction = remote_index()
        malformed_direction["fields"][0]["order"] = "SIDEWAYS"
        for record in ({}, None, missing_name, missing_state,
                       malformed_fields, malformed_direction):
            with self.subTest(record=record):
                api = FakeAPI({DELTA["collectionGroup"]: [[record]]})
                with self.assertRaises(index_gate.GateError):
                    self.ensure(api, approved_missing=self.approved_delta())
                self.assertEqual(api.creates, [])

    def test_readiness_timeout_fails_with_bounded_polling(self):
        api = FakeAPI({DELTA["collectionGroup"]: [[remote_index(state="CREATING")]]})
        with self.assertRaises(index_gate.GateError):
            self.ensure(api, timeout=2.5)
        self.assertEqual(api.creates, [])
        self.assertGreaterEqual(self.clock.now, 2.5)
        self.assertLessEqual(self.clock.now, 3.5)
        self.assertLessEqual(len(api.reads), 5)

    def test_ready_result_received_after_deadline_cannot_pass_gate(self):
        clock = self.clock

        class SlowAPI(FakeAPI):
            def list_indexes(self, collection):
                result = super().list_indexes(collection)
                clock.now += 3
                return result

        api = SlowAPI({DELTA["collectionGroup"]: [[remote_index()]]})
        with self.assertRaises(index_gate.GateError):
            self.ensure(api, timeout=2.5)
        self.assertEqual(api.creates, [])

    def test_failed_index_cannot_be_reported_ready(self):
        api = FakeAPI({DELTA["collectionGroup"]: [[remote_index(state="NEEDS_REPAIR")]]})
        with self.assertRaises(index_gate.GateError):
            self.ensure(api)
        self.assertEqual(api.creates, [])


class FirestoreHTTPTests(unittest.TestCase):
    def make_api(self, opener):
        return index_gate.FirestoreAPI(
            project=PROJECT, database=DATABASE,
            token_provider=lambda: "unit-test-token-DO-NOT-LOG", opener=opener,
            timeout=20,
        )

    def test_authenticated_request_uses_expected_url_timeout_and_json(self):
        observed = []

        def opener(request, **kwargs):
            observed.append((request, kwargs))
            return FakeResponse({"name": "operations/fake"})

        api = self.make_api(opener)
        path = "/v1/projects/repaido/databases/(default)/collectionGroups/example/indexes"
        payload = {"queryScope": "COLLECTION", "fields": DELTA["fields"]}
        result = api.request("POST", path, payload)
        self.assertEqual(result, {"name": "operations/fake"})
        self.assertEqual(len(observed), 1)
        request, kwargs = observed[0]
        self.assertEqual(request.full_url, "https://firestore.googleapis.com" + path)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer unit-test-token-DO-NOT-LOG")
        self.assertEqual(json.loads(request.data), payload)
        self.assertEqual(kwargs["timeout"], 20)

    def test_unauthorized_error_never_exposes_token_or_response_body(self):
        observed = []

        def opener(request, **kwargs):
            observed.append(request)
            body = b'{"error":"unit-test-token-DO-NOT-LOG private-response-text"}'
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO(body))

        api = self.make_api(opener)
        with self.assertRaises(index_gate.GateError) as caught:
            api.request("GET", "/v1/projects/repaido/databases/(default)/collectionGroups/example/indexes")
        message = str(caught.exception)
        self.assertIn("401", message)
        self.assertNotIn("unit-test-token-DO-NOT-LOG", message)
        self.assertNotIn("private-response-text", message)
        self.assertEqual(len(observed), 1)

    def test_http_conflict_is_reported_as_already_exists(self):
        def opener(request, **kwargs):
            raise urllib.error.HTTPError(request.full_url, 409, "Conflict", {}, io.BytesIO(b"{}"))

        api = self.make_api(opener)
        with self.assertRaises(index_gate.AlreadyExists):
            api.create_index(copy.deepcopy(DELTA))

    def test_list_uses_server_default_size_and_preserves_page_tokens(self):
        # Production Firestore rejects every nonzero pageSize value.
        from urllib.parse import parse_qs, urlsplit
        observed = []
        def opener(request, **kwargs):
            query = parse_qs(urlsplit(request.full_url).query)
            observed.append(query)
            if query.get('pageSize', ['0']) != ['0']:
                raise urllib.error.HTTPError(request.full_url, 400, 'Only 0 is supported', {}, io.BytesIO(b'{}'))
            if len(observed) == 1:
                return FakeResponse({'indexes': [remote_index(index_id='first')], 'nextPageToken': 'next/+token='})
            self.assertEqual(query.get('pageToken'), ['next/+token='])
            return FakeResponse({'indexes': [remote_index(index_id='second')]})
        rows = self.make_api(opener).list_indexes(DELTA['collectionGroup'])
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(observed), 2)

    def test_malformed_list_envelope_is_rejected(self):
        for body in ({"indexes": {}}, {"indexes": "not-an-array"}, [remote_index()]):
            with self.subTest(body=body):
                api = self.make_api(lambda request, **kwargs: FakeResponse(body))
                with self.assertRaises(index_gate.GateError):
                    api.list_indexes(DELTA["collectionGroup"])


if __name__ == "__main__":
    unittest.main()
