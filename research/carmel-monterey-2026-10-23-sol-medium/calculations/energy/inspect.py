"""Recheck archived primary-source text and hashes. No indicator is derived."""
from pathlib import Path
import hashlib,json,subprocess
HERE=Path(__file__).resolve().parent
sources=json.loads((HERE/'raw-manifest.json').read_text())
for source in sources:
    p=HERE/source['file']
    assert hashlib.sha256(p.read_bytes()).hexdigest()==source['sha256'],p
    text=subprocess.check_output(['pdftotext','-layout',str(p),'-'],text=True)
    for needle in source['required_text']:
        assert needle in text,(p,needle)
print('All archived PDFs match hashes and required methodological/table text. No median can be reconstructed from cohort averages; no score calculated.')
