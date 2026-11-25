import os
from pathlib import Path

def workbench_root():
    return Path(os.environ.get("JD_REPORT_WORKDIR") or str(Path.home() / ".jd-reports")).resolve()
