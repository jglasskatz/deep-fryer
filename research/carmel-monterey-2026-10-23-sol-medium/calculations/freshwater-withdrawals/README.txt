Run python3 inspect.py from any directory. All input paths resolve relative to this script.
The raw supplier CSV was downloaded on 2026-10-23 from:
https://publish.data.ca.gov/dataset/c69ac02b-adfb-459a-bc58-bf69a8b572d2/resource/f4d50112-5fb5-4066-b45c-44696b10a49e/download/monthly_combined_dataset.csv
It contains supplier/system observations, not complete jurisdiction observations. coverage-inspection.json is an extraction, not a scored indicator.
The raw MPWMD committee packet was downloaded on 2026-10-23 from:
https://www.mpwmd.net/wp-content/uploads/Dec-4-2025-WDC-Mtg-Agenda.pdf
Its text was extracted with pdftotext -layout. Pages 10-12 show mixed selected-year, unspecified five-year, and ten-year consumption averages; page 10 explicitly includes 2018-2020. Customers are service accounts, not population. A standalone current annual Carmel R-GPCD cannot be reproduced from these tables. The County row is a partial unincorporated CalAm service geography, not all Monterey County. Context exhibits were archived separately with capture-evidence.ts in each tenant; see evidence-additions/freshwater-withdrawals.json.
No numeric finding or threshold change was made. The configured 55 GPCD threshold is retained and no score is computed for a gap.
