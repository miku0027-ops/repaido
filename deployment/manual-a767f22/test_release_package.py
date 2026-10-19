"""Offline exact-source, build-step and helper-branch preparation regressions."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import index_gate
import verify_payload

ROOT=Path(__file__).resolve().parent
SHA='a767f224cba32b60f47b0cd00ae86300c06e354a'
BASE='f1ef43876da329647283fcbb704aaca6944e0693'
STEP_HASHES={
 'require-explicit-release':'c5d20db1156152ffd2c81ba6f9fd11d397eeb42b02e10900192023f399b10285',
 'check-build-history-access':'cdc0df87d41cae4067a0cc4608e440861f4d76583e973a059415cb4aff985d4e',
 'backend-tests':'4db74adc0e2b23e1d306d7f560a37c40f54c08b92d6fe9f186c8d7680b8f1400',
 'build-api':'92cb44619c3e1947f05dac30a7e1bd320517785e29b1542189c8ac915f5143ca',
 'push-api':'a363934fd1cf5576d91b98b554f2528a7a061f4082d9bf007e4c46f634a72224',
 'deploy-candidate':'7131888b071688d4f05d3452d3ff1c5d3bd98a7b6c6a4741cc922e96cd32e172',
 'await-release-turn':'98d64b6e9894e48fa346271aab473ff101433f9c92cb5d8927babb4a6b4eee78',
 'deploy-work-services':'6ac437b13ede68b83afa9568e32c077bcf85871c03bf7c6f3a896ba8a555c7c1',
 'promote-backend':'13e341afb348cd1d2c74641fcded5cbc964ad2b20bae6f24f16a8b004ee1fe63',
 'promote-work-services':'1585b1cc140f362f544b3f7eb7e372830fa673bf9e0b39a89c9bca70d279da25',
 'verify-selective-release':'1f33bb7439d9ecc2c33706c8c7b9c42baf37b882b7d68ab605fb2dc8696f5686',
}
def sha(data):return hashlib.sha256(data).hexdigest()

class PackageTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.config=json.loads((ROOT/'cloudbuild-api-index-gated.json').read_text())
  cls.temp=tempfile.TemporaryDirectory(prefix='repaido-source-guard-test-')
  cls.source=Path(cls.temp.name)
  with tarfile.open(ROOT/verify_payload.ARCHIVE,'r:gz') as archive:
   archive.extractall(cls.source,filter='data')
  cls.code=cls.config['steps'][0]['args'][1]
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def guard(self,**substitutions):
  values={'${_RELEASE_APPROVED}':'true','$COMMIT_SHA':SHA,'$PROJECT_ID':'repaido','${_REGION}':'us-central1','${_SERVICE}':'repaido-api','${_IMAGE}':'us-central1-docker.pkg.dev/repaido/cloud-run-source-deploy/repaido-api'}
  values.update(substitutions)
  code=self.code.replace("Path('/workspace')",repr(self.source))
  # repr(Path) produces PosixPath(); inject Path directly instead.
  code=code.replace(repr(self.source),"Path("+repr(str(self.source))+")")
  for name,value in values.items():code=code.replace(name,value)
  with contextlib.redirect_stdout(io.StringIO()):exec(compile(code,'reviewed-source-guard','exec'),{})
 def test_exact_archive_and_source_guard_pass(self):
  self.assertEqual(verify_payload.verify(ROOT),1268)
  self.guard()
 def test_all_canonical_api_steps_preserved_in_order(self):
  steps=[s for s in self.config['steps'] if s['id'] in STEP_HASHES]
  self.assertEqual([s['id'] for s in steps],list(STEP_HASHES))
  for step in steps:self.assertEqual(sha(json.dumps(step,sort_keys=True,separators=(',',':')).encode()),STEP_HASHES[step['id']])
  self.assertEqual(self.config['substitutions']['_RELEASE_APPROVED'],'false')
 def test_no_rules_hosting_or_index_deletes(self):
  ids=[s['id'] for s in self.config['steps']]
  self.assertNotIn('deploy-firestore-rules',ids)
  self.assertNotIn('deploy-firebase-hosting',ids)
  for target in ('deploy-candidate','deploy-work-services','promote-backend','promote-work-services'):
   self.assertEqual(ids[ids.index(target)-1],'verify-indexes-before-'+target)
 def test_only_exact_ops_jobs_index_can_be_added(self):
  info=json.loads((ROOT/'package-info.json').read_text())
  desired,added=index_gate.reviewed_documents(self.source/'firestore.indexes.json',ROOT/'baseline-firestore.indexes.json',info['desired_indexes_sha256'],info['baseline_indexes_sha256'])
  self.assertEqual(len(desired),8)
  self.assertEqual(added,{index_gate.normalized_spec({'collectionGroup':'ops_jobs','queryScope':'COLLECTION','fields':[{'fieldPath':'worker_id','order':'ASCENDING'},{'fieldPath':'state','order':'ASCENDING'}]})})
 def test_source_change_rejected(self):
  target=self.source/'backend/hourly_hiring.py';old=target.read_bytes()
  try:
   target.write_bytes(old+b'\n# tampered\n')
   with self.assertRaises(SystemExit):self.guard()
  finally:target.write_bytes(old)
 def test_extra_source_rejected(self):
  target=self.source/'unexpected.txt';target.write_text('extra')
  try:
   with self.assertRaises(SystemExit):self.guard()
  finally:target.unlink()
 def test_missing_source_rejected(self):
  target=self.source/'backend/hourly_hiring.py';old=target.read_bytes();target.unlink()
  try:
   with self.assertRaises(SystemExit):self.guard()
  finally:target.write_bytes(old)
 def test_symlink_rejected(self):
  target=self.source/'linked.txt';target.symlink_to('cloudbuild-api.yaml')
  try:
   with self.assertRaises(SystemExit):self.guard()
  finally:target.unlink()
 def test_manifest_change_rejected(self):
  target=self.source/'release_support/reviewed-source.json';old=target.read_bytes()
  try:
   target.write_bytes(old+b' ')
   with self.assertRaises(SystemExit):self.guard()
  finally:target.write_bytes(old)
 def test_approval_commit_project_service_region_image_must_match(self):
  for key,value in [('${_RELEASE_APPROVED}','false'),('$COMMIT_SHA','0'*40),('$PROJECT_ID','other-project'),('${_SERVICE}','other-api'),('${_REGION}','europe-west1'),('${_IMAGE}','elsewhere/image')]:
   with self.subTest(key=key),self.assertRaises(SystemExit):self.guard(**{key:value})
 def test_prepare_archives_application_commit_from_clean_descendant_head(self):
  spec=importlib.util.spec_from_file_location('prepare_under_test',ROOT/'prepare.py')
  prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
  with tempfile.TemporaryDirectory(prefix='repaido-prepare-fixture-') as temp:
   base=Path(temp);repo=base/'repo';repo.mkdir();out=base/'support';out.mkdir()
   def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL)
   git('init');(repo/'app.txt').write_bytes(b'pinned application\n');git('add','app.txt');git('-c','user.name=Release test','-c','user.email=release-test@example.invalid','commit','-m','application')
   pinned=git('rev-parse','HEAD').decode().strip()
   (repo/'app.txt').write_bytes(b'head contains a different application\n');git('add','app.txt');git('-c','user.name=Release test','-c','user.email=release-test@example.invalid','commit','-m','descendant')
   (out/'index_gate.py').write_bytes(b'index helper\n');(out/'baseline-firestore.indexes.json').write_bytes(b'baseline\n')
   files={'app.txt':sha(b'pinned application\n'),'release_support/index_gate.py':sha(b'index helper\n'),'release_support/baseline-firestore.indexes.json':sha(b'baseline\n')}
   doc={'commit':pinned,'files':files};raw=json.dumps(doc).encode()
   with patch.object(prepare,'COMMIT',pinned),patch.object(prepare,'__file__',str(out/'prepare.py')),patch.object(prepare,'manifest',return_value=(raw,doc)),patch.object(prepare,'verify',return_value=4),patch.object(sys,'argv',['prepare.py',str(repo)]),contextlib.redirect_stdout(io.StringIO()):prepare.main()
   with tarfile.open(out/prepare.ARCHIVE,'r:gz') as archive:self.assertEqual(archive.extractfile('app.txt').read(),b'pinned application\n')

if __name__=='__main__':unittest.main()
