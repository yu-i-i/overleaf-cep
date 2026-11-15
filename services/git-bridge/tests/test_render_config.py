import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('render_config', ROOT / 'render-config.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RenderConfigTest(unittest.TestCase):
    def render(self, **environ):
        return renderer.render_config((ROOT / 'conf/envsubst_template.json').read_text(), environ)

    def test_defaults(self):
        config = self.render()
        self.assertEqual(config['port'], 8000)
        self.assertFalse(config['userPasswordEnabled'])
        self.assertEqual(config['swapStore']['awsAccessKey'], '')

    def test_empty_uses_default(self):
        self.assertEqual(self.render(GIT_BRIDGE_PORT='')['port'], 8000)

    def test_values_keep_types(self):
        config = self.render(GIT_BRIDGE_PORT='9000', GIT_BRIDGE_USER_PASSWORD_ENABLED='true')
        self.assertEqual(config['port'], 9000)
        self.assertIs(config['userPasswordEnabled'], True)

    def test_strings_are_json_escaped(self):
        value = '研究室 "Git"\\repo\n${GIT_BRIDGE_PORT}'
        config = self.render(GIT_BRIDGE_SERVICE_NAME=value)
        self.assertEqual(json.loads(json.dumps(config))['serviceName'], value)

    def test_invalid_values_fail_without_echoing_secrets(self):
        for value in ['secret-value', '[]', '{}', 'true', '"9000"', '0,"extra":true']:
            with self.subTest(value=value), self.assertRaises(ValueError) as error:
                self.render(GIT_BRIDGE_PORT=value)
            self.assertNotIn(value, str(error.exception))

    def test_boolean_does_not_accept_integer(self):
        with self.assertRaises(ValueError):
            self.render(GIT_BRIDGE_USER_PASSWORD_ENABLED='1')


if __name__ == '__main__':
    unittest.main()
