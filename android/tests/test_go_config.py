"""Wrong-package configuration must not produce a distributable Go build."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('go_build', Path(__file__).resolve().parents[1] / 'go/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class GoConfigTests(unittest.TestCase):
    def config(self, package='com.repaido.go'):
        return {'project_info': {'project_id': 'repaido', 'project_number': '133610574058'},
                'client': [{'client_info': {'android_client_info': {'package_name': package},
                            'mobilesdk_app_id': '1:133610574058:android:abcdef'},
                            'api_key': [{'current_key': 'test-fixture-not-a-real-key'}]}]}

    def parse(self, data, audience='customer'):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'google-services.json'
            path.write_text(json.dumps(data))
            return build.firebase_properties(path, audience)

    def test_each_app_requires_its_own_package(self):
        for audience, package in build.PACKAGES.items():
            result = self.parse(self.config(package), audience)
            self.assertEqual(result['ORG_GRADLE_PROJECT_REPAIDO_GO_' + audience.upper() + '_FIREBASE_APP_ID'], '1:133610574058:android:abcdef')
        with self.assertRaises(ValueError):
            self.parse(self.config('com.repaido.app'))
        with self.assertRaises(ValueError):
            self.parse(self.config(), 'driver')

    def test_wrong_project_or_ambiguous_client_stops(self):
        config = self.config()
        config['project_info']['project_id'] = 'different-project'
        with self.assertRaises(ValueError):
            self.parse(config)
        config = self.config()
        config['client'] *= 2
        with self.assertRaises(ValueError):
            self.parse(config)


if __name__ == '__main__':
    unittest.main()
