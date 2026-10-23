"""Read-only source extraction; no safe-water percentage is calculated.

Run with python3 extract.py from any working directory. Inputs are preserved
official ACR XLSX bytes and EPA ECHO JSON returned on 2026-10-23 UTC.
"""
from pathlib import Path
import collections
import json
import xml.etree.ElementTree as ET
import zipfile

base = Path(__file__).resolve().parent
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(base / "acr-2025-dataset.xlsx") as archive:
    strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
    rows = []
    for row in ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).findall(".//s:row", ns):
        values = {}
        for cell in row.findall("s:c", ns):
            node = cell.find("s:v", ns)
            value = node.text if node is not None else ""
            if cell.get("t") == "s":
                value = strings[int(value)]
            values["".join(filter(str.isalpha, cell.get("r")))] = value
        rows.append(values)
header = rows[0]
county = [{header[col]: value for col, value in row.items()} for row in rows[1:] if row.get("A") == "MONTEREY"]
systems = json.loads((base / "monterey-echo-results.json").read_text())["Results"]["WaterSystems"]
active = [system for system in systems if system["PWSActivityCode"] == "A"]
summary = {
    "acr_reporting_year": 2025,
    "acr_county_field": "principle_county",
    "acr_county_rows": len(county),
    "acr_county_distinct_systems": len({row["PWSID"] for row in county}),
    "acr_monterey_system_records": [row for row in county if row["PWSID"] == "CA2710004"],
    "echo_returned_rows": len(systems),
    "echo_active_rows": len(active),
    "echo_active_by_system_type": dict(collections.Counter(system["PWSTypeCode"] for system in active)),
    "echo_monterey_system": [system for system in active if system["PWSId"] == "CA2710004"],
    "not_calculated": "No jurisdiction safe-water percentage. ACR is a violations-only table, not an all-system denominator; current ECHO population and historical ACR population differ; ECHO CountiesServed is not a quality-assured population allocation. Non-community populations can overlap residential populations. HealthFlag alone does not establish the annual reporting interval."
}
(base / "acr-2025-monterey-records.json").write_text(json.dumps(county, indent=2) + "\n")
(base / "source-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({key: summary[key] for key in ["acr_county_rows", "acr_county_distinct_systems", "echo_returned_rows", "echo_active_rows"]}))
