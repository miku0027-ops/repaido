"""Pre-submit checks against the inventory produced by gcloud, without cloud calls."""
import importlib.util
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('build_source',Path(__file__).resolve().parents[1]/'scripts/check-build-source.py')
source=importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


def test_missing_mail_setup_script_rejected_before_build_submission():
    with pytest.raises(ValueError,match='configure-transactional-email.sh'):
        source.validate(source.REQUIRED-{'scripts/configure-transactional-email.sh'})


def test_full_inventory_including_relative_prefixes_passes():
    assert source.validate(['./'+name for name in source.REQUIRED])==len(source.REQUIRED)


@pytest.mark.parametrize('name',['web/.env.production','backend/.env','web/node_modules/pkg/index.js','backend/.venv/bin/python','.git/config'])
def test_local_dependencies_and_environment_files_are_rejected(name):
    with pytest.raises(ValueError,match='Do not upload'):
        source.validate([*source.REQUIRED,name])
