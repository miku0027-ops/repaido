"""Guard Android release packaging without requiring an SDK or signing key.

Run from the repository root: python3 -m unittest discover -s android/tests
"""
import re
import unittest
from pathlib import Path


ANDROID = Path(__file__).resolve().parents[1]


class ReleaseSigningTests(unittest.TestCase):
    def test_release_variants_never_use_the_development_signer(self):
        for module in ('app', 'agent', 'preview', 'go'):
            with self.subTest(module=module):
                source = (ANDROID / module / 'build.gradle.kts').read_text()
                start = re.search(r'\brelease\s*\{', source)
                self.assertIsNotNone(start, f'{module} must declare its release build type')
                depth, end = 1, start.end()
                while depth and end < len(source):
                    depth += (source[end] == '{') - (source[end] == '}')
                    end += 1
                self.assertEqual(depth, 0, f'{module} release block must be balanced')
                release = source[start.end():end - 1]
                self.assertNotRegex(release, r'(?i)signingConfig\s*=.*\bdebug\b',
                                    f'{module} release must never use the development signing key')


if __name__ == '__main__':
    unittest.main()
