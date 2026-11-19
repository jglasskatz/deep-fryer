// Doughnut data for all three jurisdictions
// Level scale: -100 = no problem, -50 = under control, 0 = on track, 50 = not good, 100 = out of control, 150 = severe, NaN = unknown

const JURISDICTIONS = {
    "city_san_francisco": {
        name: "City of San Francisco",
        population: "~808,000",
        description: "Commercial and cultural center of Northern California. Known for technological innovation, dense urban grid, high cost of living, and progressive climate policy.",
        ecological: [
            {
                name: "climate change",
                level: 76,
                indicator: "Consumption-based CO2e per capita",
                value: "4.4",
                year: 2022,
                target: "0.0",
                context: "San Francisco's consumption-based footprint accounts for ~4.4 metric tons of CO2e per capita, creating a significant ecological overshoot that strains planetary boundaries.",
                source: "San Francisco Community GHG Inventory / SF Environment",
                sourceUrl: "https://www.sfenvironment.org",
                screenshot: null,
                actions: ["Implement deep building decarbonization mandates and scale up zero-emission transportation infrastructure across the city."]
            },
            {
                name: "ocean acidification",
                level: 0,
                indicator: "Regional environmental baseline",
                value: "Compliant with state limits",
                year: 2024,
                target: "Planetary boundary alignment",
                context: "San Francisco Bay monitoring systems track aggregate marine thresholds for this index.",
                source: "EPA / NOAA Region 9",
                sourceUrl: "https://www.epa.gov",
                screenshot: null,
                actions: ["Support clean water regulations."]
            },
            {
                name: "chemical pollution",
                level: 0,
                indicator: "Regional environmental baseline",
                value: "Compliant with state limits",
                year: 2024,
                target: "Planetary boundary alignment",
                context: "San Francisco Bay monitoring systems track aggregate marine thresholds for this index.",
                source: "EPA / NOAA Region 9",
                sourceUrl: "https://www.epa.gov",
                screenshot: null,
                actions: ["Support safe run-off remediation programs."]
            },
            {
                name: "nitrogen & phosphorus loading",
                level: 66,
                indicator: "% Inorganic Nitrogen Load Overshoot",
                value: "66%",
                year: 2024,
                target: "0%",
                context: "San Francisco operates at a 66% ecological overshoot, discharging 17.3 tons of inorganic nitrogen per day against a science-based 2035 safe limit of 10.4 tons.",
                source: "SF Bay Regional Water Quality Control Board (Permit R2-2024-0013)",
                sourceUrl: "https://www.waterboards.ca.gov/sanfranciscobay",
                screenshot: null,
                actions: ["Upgrade regional wastewater treatment infrastructure and expand nature-based wetland filters to strip nitrogen before it enters the Bay ecosystem."]
            },
            {
                name: "freshwater withdrawals",
                level: 42,
                indicator: "Residential water use per capita (gpcd)",
                value: "42",
                year: 2025,
                target: "45",
                context: "San Franciscans maintain a low residential water consumption baseline of 42 gallons per capita per day operating within the city's 45-gallon conservation target, yet systemic imported pressure strains regional river ecosystems during dry-year cycles.",
                source: "SF Public Utilities Commission (SFPUC) Water Resources Report",
                sourceUrl: "https://sfpuc.org",
                screenshot: null,
                actions: ["Expand local recycled water irrigation networks and scale up the implementation of onsite non-potable water reuse systems."]
            },
            {
                name: "land conversion",
                level: 51.7,
                indicator: "% Permeable and Vegetated Surface Area",
                value: "48.3%",
                year: 2024,
                target: "60%",
                context: "Roughly 51.7% of San Francisco's land surface remains covered by impervious concrete and asphalt, leaving a 11.7% shortfall to reach the city's 60% permeable and vegetated grid target.",
                source: "SF Planning Department/Urban Forestry Master Plan",
                sourceUrl: "https://sfplanning.org",
                screenshot: null,
                actions: ["Accelerate pavement-to-parks conversions and mandate green roof infrastructures on all new commercial developments."]
            },
            {
                name: "biodiversity loss",
                level: 55,
                indicator: "% of Key Estuary Indicator Species in \"Good/Improving\" Status",
                value: "45%",
                year: 2025,
                target: "100%",
                context: "45% of key indicator species (birds and fish) in the San Francisco Estuary are in \"Good\" or \"Improving\" status, while 55% remain in decline or \"Poor\" condition.",
                source: "The San Francisco Estuary Partnership (State of Our Estuary Report)",
                sourceUrl: "https://www.sfestuary.org",
                screenshot: null,
                actions: ["Mandate strict regional shoreline habitat protections and expand marsh restoration projects to revive native fish and avian populations."]
            },
            {
                name: "air pollution",
                level: 10.4,
                indicator: "% of Days with \"Good\" AQI",
                value: "89.6%",
                year: 2024,
                target: "100%",
                context: "89.6% of days in San Francisco maintain a \"Good\" Air Quality Index baseline, yet a 10.4% shortfall persists due to seasonal wildfire smoke and localized transport emissions.",
                source: "Bay Area Air Quality Management District (BAAQMD)",
                sourceUrl: "https://www.baaqmd.gov",
                screenshot: null,
                actions: ["Accelerate the electrification of regional transport fleets and expand urban tree canopy networks to mitigate localized particulate matter."]
            },
            {
                name: "ozone layer depletion",
                level: 0,
                indicator: "Regional environmental baseline",
                value: "Compliant with state limits",
                year: 2024,
                target: "Planetary boundary alignment",
                context: "San Francisco Bay monitoring systems track aggregate marine thresholds for this index.",
                source: "EPA / NOAA Region 9",
                sourceUrl: "https://www.epa.gov",
                screenshot: null,
                actions: ["Use green alternatives during infrastructure updates."]
            }
        ],
        social: [
            {
                name: "food",
                level: 68,
                indicator: "% of Food Bank Enrollees Actively Working",
                value: "68%",
                year: 2025,
                target: "100% Wage Parity",
                context: "68% of food bank enrollees are actively working, yet an All-Food CPI increase of 23.6% (2020-2024) forces a persistent 'rent eats first' tradeoff where a single adult needs $59,823/year just to survive.",
                source: "SF-Marin Food Bank Hunger Report 2025 / FSTF Recommendations 2026",
                sourceUrl: "https://www.sf.gov/departments--department-public-health",
                screenshot: null,
                actions: ["Align local minimum wage ordinances with the localized Self-Sufficiency Standard baseline.","Overhaul local permitting processes to lower barriers for community-scaled food micro-enterprises.","Subsidize and expand neighborhood-scale pay-what-you-can retail and recovery markets."]
            },
            {
                name: "health",
                level: 32,
                indicator: "% Pop in \"Safe\" ZIP Codes",
                value: "68%",
                year: 2024,
                target: "100%",
                context: "Average life expectancy is 82.9 years, yet 32% of San Francisco neighborhoods fall below global health benchmarks.",
                source: "SF Dept of Public Health",
                sourceUrl: "https://www.sf.gov/departments--department-public-health",
                screenshot: null,
                actions: ["Expand community health clinics and address environmental health disparities across neighborhoods."]
            },
            {
                name: "education",
                level: 23,
                indicator: "% Students NOT Chronically Absent",
                value: "77%",
                year: 2024,
                target: "100%",
                context: "70% of adults hold post-secondary degrees, yet 23% of K-12 students are chronically absent and only 50% of 3rd graders read at grade level.",
                source: "SFUSD Data Dashboards",
                sourceUrl: "https://www.sfusd.edu",
                screenshot: null,
                actions: ["Address systemic housing and transportation barriers to increase daily classroom attendance."]
            },
            {
                name: "income & work",
                level: 27,
                indicator: "% Households above \"Real Cost\"",
                value: "73%",
                year: 2024,
                target: "100%",
                context: "Labor force participation is 69.6%, yet 27% of San Francisco households earn less than the $136,872 \"Real Cost\" self-sufficiency standard.",
                source: "United Way of California (Real Cost Measure)",
                sourceUrl: "https://www.unitedwaysca.org/realcost",
                screenshot: null,
                actions: ["Prioritize economic growth in sectors providing middle income living wages."]
            },
            {
                name: "housing",
                level: 38.4,
                indicator: "% Non-Burdened Renters",
                value: "61.6%",
                year: 2024,
                target: "100%",
                context: "38.4% of San Francisco renters face a severe housing cost burden, spending more than 30-50% of their household income on rent.",
                source: "ACS/Housing Needs Assessment",
                sourceUrl: "https://data.sfgov.org",
                screenshot: null,
                actions: ["Protect tenants from displacement and accelerate the production of permanently affordable social housing."]
            },
            {
                name: "water & sanitation",
                level: 15,
                indicator: "% of HHs with piped water & affordable rates",
                value: "85%",
                year: 2024,
                target: "100%",
                context: "85% of households have reliable, piped water access under affordable rates, but a 15% structural shortfall persists due to aging infrastructure and rising utility cost burdens.",
                source: "SF Public Utilities Commission",
                sourceUrl: "https://sfpuc.org",
                screenshot: null,
                actions: ["Upgrade local water distribution infrastructure and expand utility rate assistance safety nets for low income households."]
            },
            {
                name: "energy",
                level: 11.2,
                indicator: "% Not Energy Burdened",
                value: "88.8%",
                year: 2024,
                target: "100%",
                context: "88.8% of households are not energy burdened, meaning roughly 11.2% of residents face high utility bills that strain their basic financial baseline.",
                source: "California Energy Commission (CEC)",
                sourceUrl: "https://www.energy.ca.gov",
                screenshot: null,
                actions: ["Expand municipal clean energy assistance program and accelerate rooftop solar/efficiency retrofits for low income housing."]
            },
            {
                name: "social equity",
                level: 39,
                indicator: "% Feeling Respected/Included",
                value: "61%",
                year: 2024,
                target: "100%",
                context: "61% of residents report feeling respected and included in their neighborhood, exposing a 39% shortfall in social cohesion and belonging across diverse populations.",
                source: "City Controller Community Survey",
                sourceUrl: "https://data.sfgov.org",
                screenshot: null,
                actions: ["Expand localized community building programs and invest in inclusive neighborhood gathering spaces."]
            },
            {
                name: "peace & justice",
                level: 48,
                indicator: "% Perceived Safety at Night",
                value: "52%",
                year: 2025,
                target: "100%",
                context: "52% of San Francisco residents report feeling \"safe\" or \"very safe\" walking alone in their neighborhood after dark, highlighting a stark 48% gap in urban peace and community trust.",
                source: "Projected Synthesis",
                sourceUrl: "https://data.sfgov.org",
                screenshot: null,
                actions: ["Implement community led violence intervention frameworks and invest in neighborhood social infrastructure to rebuild localized safety and trust."]
            },
            {
                name: "political voice",
                level: 44,
                indicator: "% Turnout in Non-Pres. Elections",
                value: "55.6%",
                year: 2024,
                target: "86.0%",
                context: "General election turnout is 78.9%, but falls to 55.6% for local cycles, with residents directly controlling <0.01% of the city's $15.9B budget.",
                source: "San Francisco City Data Portals",
                sourceUrl: "https://data.sfgov.org",
                screenshot: null,
                actions: ["Increase engagement in local elections cycles."]
            },
            {
                name: "gender equality",
                level: 13,
                indicator: "Female-to-male earnings ratio",
                value: "0.87",
                year: 2024,
                target: "1.00",
                context: "Women in San Francisco earn an average of 87 cents for every dollar earned by men, exposing an unclosed 13% structural gender wage gap.",
                source: "American Community Survey (ACS)",
                sourceUrl: "https://data.sfgov.org",
                screenshot: null,
                actions: ["Enforce local pay transparency ordinances and expand equal opportunity pathways into high-wage economic sectors."]
            },
            {
                name: "networks",
                level: 48,
                indicator: "% Commute by Transit/Walk/Bike",
                value: "52%",
                year: 2022,
                target: "100%",
                context: "52% of work trips are made by public transport, walking, or cycling, leaving 48% dependent on personal vehicles.",
                source: "SFMTA/American Community Survey (ACS)",
                sourceUrl: "https://www.sfmta.com",
                screenshot: null,
                actions: ["Expand transit infrastructure, bus-only lanes and protected bike networks to accelerate low-carbon travel."]
            }
        ]
    },
     "soma_sf": {
        name: "SoMa",
        population: "~30,000",
        description: "SoMa (South of Market) is a vibrant, densely populated San Francisco district covering about 3 square miles with a significant weekday influx of professionals.",
        ecological: [
            {
                name: "climate change",
                level: 50,
                indicator: "Total GHG emissions",
                value: "160,622 MT CO2e (~3.04/capita est.)",
                year: 2017,
                target: "Net-negative by 2030 (aspirational); 80% below 1990 (legal)",
                context: "Transportation 53%, Natural Gas 28%, Electricity 11%, Solid Waste 8%. 100% carbon-free electricity since 2018 via 3CE. 21.7% reduction achieved.",
                source: "City of Watsonville CAAP 2030",
                sourceUrl: "https://www.watsonville.gov/DocumentCenter/View/17209/CAAP-2030-Executive-Summary-",
                screenshot: "img/watsonville_emissions_targets.png",
                actions: [
                    "Switch to electric vehicles — transportation is 53% of emissions",
                    "Electrify home heating (replace gas furnaces and water heaters)",
                    "Upgrade to 3CE Prime for 100% renewable electricity",
                    "Compost food waste — solid waste is 8% of emissions",
                    "Support Watsonville's Climate Action & Adaptation Plan"
                ]
            },
            {
                name: "ocean acidification",
                level: 50,
                indicator: "Coastal impacts",
                value: "Regional monitoring",
                year: 2024,
                target: "Maintain marine ecosystem health",
                context: "Watsonville coast and Pajaro River estuary affected by agricultural runoff and ocean acidification.",
                source: "MBARI",
                sourceUrl: "https://www.mbari.org/",
                screenshot: null,
                actions: ["Reduce carbon footprint", "Reduce agricultural runoff"]
            },
            {
                name: "chemical pollution",
                level: 150,
                indicator: "Pesticide use",
                value: "Epicenter of county's ~1M lbs/year",
                year: 2022,
                target: "Reduce fumigant use; protect farmworkers",
                context: "Watsonville IS the center of pesticide use in the county. 67% fumigant gases. Strawberry and lettuce farming. CalEnviroScreen flags south county as high pesticide exposure. Major environmental justice concern.",
                source: "CA DPR; CalEnviroScreen",
                sourceUrl: "https://www.cdpr.ca.gov/wp-content/uploads/2024/12/2022_santa_cruz_commodity.pdf",
                screenshot: "img/pesticide_use_report_2022.png",
                actions: [
                    "Support farmworker health organizations (e.g., COPA)",
                    "Buy organic strawberries and produce",
                    "Advocate for buffer zones around schools and homes",
                    "Support transition to organic/regenerative agriculture",
                    "Push for stricter fumigant regulations"
                ]
            },
            {
                name: "nitrogen & phosphorus loading",
                level: 150,
                indicator: "Groundwater nitrate",
                value: "87% from agriculture — severe",
                year: 2015,
                target: "Below 10 mg/L NO3-N",
                context: "Watsonville sits in the heart of Pajaro Valley — the most contaminated area. Drinking water directly from Pajaro Valley groundwater. Seawater intrusion compounding the problem.",
                source: "Pajaro Valley Water Management Agency",
                sourceUrl: "https://www.pvwater.org/",
                screenshot: null,
                actions: [
                    "Support PVWMA recycled water and recharge projects",
                    "Advocate for agricultural nutrient management",
                    "Support drinking water treatment upgrades"
                ]
            },
            {
                name: "freshwater withdrawals",
                level: 100,
                indicator: "Groundwater overdraft",
                value: "Critically overdrafted basin",
                year: 2024,
                target: "Sustainable groundwater management (SGMA)",
                context: "Pajaro Valley basin is critically overdrafted. Seawater intrusion advancing inland. Watsonville's water supply is directly threatened.",
                source: "PVWMA",
                sourceUrl: "https://www.pvwater.org/",
                screenshot: null,
                actions: ["Conserve water aggressively", "Support recycled water projects", "Support managed aquifer recharge"]
            },
            {
                name: "land conversion",
                level: 100,
                indicator: "Protected parkland",
                value: "~2.2% of city (143 acres in 26 parks)",
                year: 2024,
                target: "Increase protected open space",
                context: "Very low compared to county (32%) and City of Santa Cruz (~20%). Agricultural land dominates. Watsonville Slough system is ecologically significant.",
                source: "City of Watsonville Parks & Recreation",
                sourceUrl: "https://www.watsonville.gov/1207/City-Parks",
                screenshot: null,
                actions: [
                    "Support expansion of parks and open space",
                    "Protect Watsonville Slough ecosystem",
                    "Advocate for community gardens and green spaces"
                ]
            },
            {
                name: "biodiversity loss",
                level: 50,
                indicator: "Habitat health",
                value: "Watsonville Slough at risk",
                year: 2024,
                target: "Restore and protect slough ecosystem",
                context: "Watsonville Slough system is critical habitat. Agricultural practices and development pressure threaten local biodiversity. Less protected land than rest of county.",
                source: "Watsonville Wetlands Watch",
                sourceUrl: "https://www.watsonvillewetlandswatch.org/",
                screenshot: null,
                actions: ["Volunteer with Watsonville Wetlands Watch", "Support slough restoration", "Report pollution"]
            },
            {
                name: "air pollution",
                level: 0,
                indicator: "PM2.5 annual average",
                value: "~7-9 \u00b5g/m\u00b3 (est.)",
                year: 2019,
                target: "WHO 2021 guideline: 5 \u00b5g/m\u00b3",
                context: "No city-specific monitor. Inland location and agricultural dust/fumigants may contribute. Meets EPA standard but exceeds revised WHO guideline.",
                source: "IQAir; DataShare SCC",
                sourceUrl: "https://www.iqair.com/us/usa/california/watsonville",
                screenshot: null,
                actions: ["Support air quality monitoring in Watsonville", "Advocate for reduced fumigant use"]
            },
            {
                name: "ozone layer depletion",
                level: -100,
                indicator: "Stratospheric ozone",
                value: "Recovering globally",
                year: 2024,
                target: "Full recovery ~2066",
                context: "Global issue, recovering due to Montreal Protocol.",
                source: "NOAA",
                sourceUrl: "https://www.epa.gov/ozone-layer-protection",
                screenshot: null,
                actions: ["Properly dispose of old refrigerants"]
            },
            {
                name: "waste & materials",
                level: 50,
                indicator: "Solid waste & diversion",
                value: "City-specific diversion rate not published",
                year: 2024,
                target: "Extend landfill life; meet SB 1383 organics targets",
                context: "Watsonville operates its own landfill and waste collection — one of the first US cities to implement mixed recyclable collection. Solid waste = 8% of city GHG (2017). SB 1383 organics collection now required. City goal: extend landfill life through recycling.",
                source: "City of Watsonville Solid Waste Division",
                sourceUrl: "https://www.watsonville.gov/1180/Solid-Waste-Division",
                screenshot: null,
                actions: [
                    "Use the green bin for food scraps (SB 1383)",
                    "Recycle correctly — Watsonville pioneered mixed-stream collection",
                    "Reduce single-use plastics, especially from agricultural packaging",
                    "Repair, reuse, and donate to extend landfill life"
                ]
            }
        ],
        social: [
            {
                name: "food",
                level: 100,
                indicator: "Food insecurity rate",
                value: "Higher than county avg (~1 in 3)",
                year: 2025,
                target: "Zero hunger",
                context: "County-wide: ~93,000 residents at risk of food insecurity (~40,900 households). Watsonville has largest SNAP gap — high proportion qualifying but not enrolled. Agricultural community paradox: grows food but can't afford it. Second Harvest serves 70K+/month.",
                source: "Blum Center / UCSC; Second Harvest Food Bank",
                sourceUrl: "https://news.ucsc.edu/2019/11/blum-foodinsecurity.html",
                screenshot: null,
                actions: [
                    "Donate to Second Harvest Food Bank",
                    "Support CalFresh enrollment in Watsonville",
                    "Advocate for farmworker food access programs",
                    "Support community gardens and food sovereignty initiatives"
                ]
            },
            {
                name: "health",
                level: 100,
                indicator: "Uninsured rate",
                value: "9.8% uninsured",
                year: 2023,
                target: "Universal coverage",
                context: "Uninsured rate 9.8% — 2.6x the City of Santa Cruz rate (3.7%). Up from 9.5% in 2022. Driven by farmworker and undocumented community. Salud Para La Gente is primary FQHC. Medicaid cuts threaten further increases.",
                source: "Census ACS via Data USA",
                sourceUrl: "https://datausa.io/profile/geo/watsonville-ca/",
                screenshot: null,
                actions: [
                    "Support Salud Para La Gente community health center",
                    "Help neighbors enroll in Medi-Cal and Covered California",
                    "Advocate against Medicaid funding cuts",
                    "Support mobile health clinics serving farmworkers"
                ]
            },
            {
                name: "education",
                level: 75,
                indicator: "HS graduation rate",
                value: "79% (PVUSD district avg)",
                year: 2024,
                target: "Match or exceed state average (87%)",
                context: "PVUSD graduation rate 79% — below CA average of 87%. Math proficiency 17% (vs 49% in SC city). Reading proficiency 27% (vs 68% in SC city). 90% minority enrollment. 54.9% economically disadvantaged. Ceiba College Prep: >95%.",
                source: "Public School Review; CA Dept of Education",
                sourceUrl: "https://www.publicschoolreview.com/california/watsonville/high",
                screenshot: null,
                actions: [
                    "Volunteer as a tutor at PVUSD schools",
                    "Support Ceiba College Prep and similar models",
                    "Advocate for equitable school funding",
                    "Support bilingual education programs"
                ]
            },
            {
                name: "income & work",
                level: 100,
                indicator: "Poverty rate",
                value: "15.1% poverty; median income $74,785",
                year: 2023,
                target: "Below 10%; living wage for all",
                context: "Median household income $74,785 — $36K less than SC city ($111,427). 15.1% below poverty line. 12.8% of families in poverty. Agricultural/service sector economy. High cost of living with lower wages than north county.",
                source: "U.S. Census Bureau ACS 5-year",
                sourceUrl: "https://www.census.gov/quickfacts/fact/table/watsonvillecitycalifornia/HSG010223",
                screenshot: null,
                actions: [
                    "Support living wage campaigns",
                    "Advocate for farmworker labor protections",
                    "Support workforce development and job training",
                    "Buy from locally owned Watsonville businesses"
                ]
            },
            {
                name: "housing",
                level: 100,
                indicator: "Housing cost burden",
                value: "Severe — rising homelessness",
                year: 2024,
                target: "Affordable housing for all; <30% rent burden",
                context: "Affordable housing rent limits: $1,627 (studio) to $2,510 (4BR). Market rate likely higher. Rising homelessness with smaller budget and fewer staff than SC city. No dedicated homelessness department. 20.4% decline in county-wide homelessness reported.",
                source: "City of Watsonville Housing Program; Santa Cruz Local",
                sourceUrl: "https://santacruzlocal.org/2024/03/26/rising-homelessness-in-watsonville-prompts-new-strategies/",
                screenshot: null,
                actions: [
                    "Advocate for Watsonville homelessness department/coordinator",
                    "Support affordable housing development",
                    "Volunteer with local shelter programs",
                    "Push for farmworker housing investments"
                ]
            },
            {
                name: "water & sanitation",
                level: 100,
                indicator: "Nitrate in drinking water",
                value: "Contaminated groundwater source",
                year: 2024,
                target: "Below 10 mg/L NO3-N in all wells",
                context: "Watsonville drinks from Pajaro Valley groundwater — severely contaminated with nitrate (87% from agriculture). Seawater intrusion advancing. Chromium-6 also detected. PVWMA managing critically overdrafted basin.",
                source: "PVWMA; State Water Board",
                sourceUrl: "https://www.pvwater.org/",
                screenshot: null,
                actions: [
                    "Support PVWMA groundwater sustainability efforts",
                    "Advocate for agricultural best management practices",
                    "Support drinking water treatment upgrades",
                    "Check your water quality report"
                ]
            },
            {
                name: "energy",
                level: 0,
                indicator: "Electricity cost & renewables",
                value: "100% carbon-free electricity via 3CE",
                year: 2024,
                target: "100% renewable; affordable rates",
                context: "Watsonville has had 100% carbon-free electricity since 2018 via 3 Clean Energy (3CE). However, energy burden for low-income households remains a concern given lower median income ($74K vs $111K in SC city).",
                source: "City of Watsonville CAAP 2030; 3CE",
                sourceUrl: "https://3ce.org/",
                screenshot: null,
                actions: [
                    "Apply for CARE/FERA low-income rate discounts",
                    "Support solar installation programs for low-income homes",
                    "Electrify home heating to leverage clean grid"
                ]
            },
            {
                name: "social equity",
                level: 100,
                indicator: "Environmental justice",
                value: "CalEnviroScreen flagged; Gini ~0.50",
                year: 2021,
                target: "Environmental and economic equity",
                context: "CalEnviroScreen flags south county as high pesticide exposure and pollution burden. County Gini 0.50 (severe inequality). Watsonville disproportionately bears county's environmental costs while having lower incomes.",
                source: "CalEnviroScreen; Census ACS",
                sourceUrl: "https://oehha.ca.gov/calenviroscreen",
                screenshot: null,
                actions: [
                    "Support environmental justice organizations (COPA, APEN)",
                    "Advocate for equitable distribution of environmental burdens",
                    "Push for buffer zones between pesticide application and communities",
                    "Support community air monitoring"
                ]
            },
            {
                name: "peace & justice",
                level: 50,
                indicator: "Crime rate trend",
                value: "5.9 violent / 18.6 property per 1,000",
                year: 2024,
                target: "Below national average",
                context: "302 violent crimes, 959 property crimes. Violent crime 58.5% above national avg. But 23% overall decline in 2024 vs 2023. 33% decline since 2020. 4-year improving trend. Property crime 4.8% below national avg.",
                source: "Watsonville PD; NeighborhoodScout",
                sourceUrl: "https://www.watsonville.gov/CivicAlerts.aspx?AID=2431",
                screenshot: null,
                actions: [
                    "Support community-based violence prevention",
                    "Engage with Watsonville PD community programs",
                    "Support youth programs and after-school activities",
                    "Advocate for restorative justice"
                ]
            },
            {
                name: "political voice",
                level: 25,
                indicator: "Voter participation",
                value: "County: 81.8% (city-level TBD)",
                year: 2024,
                target: "Above 70% in general elections",
                context: "County-wide turnout 81.8% (Nov 2024). Watsonville city-level data not yet disaggregated — historically lower turnout in south county. Nov 2024 election filled 3 city council seats (Districts 1, 2, 6).",
                source: "Santa Cruz County Elections; City of Watsonville",
                sourceUrl: "https://www.watsonville.gov/2506/November-5-2024-Election",
                screenshot: null,
                actions: [
                    "Register to vote and encourage neighbors",
                    "Attend Watsonville City Council meetings",
                    "Support voter registration drives in farmworker communities",
                    "Run for local office or join a commission"
                ]
            },
            {
                name: "gender equality",
                level: 50,
                indicator: "Gender pay ratio (est.)",
                value: "~0.85 (county-level estimate)",
                year: 2024,
                target: "Pay equity (1:1 ratio)",
                context: "No Watsonville-specific data. County ratio 0.85. CA statewide: women earn 89.9% of men (2023 BLS). Agricultural/service sector workforce may have wider gap. Needs local research.",
                source: "CA Civil Rights Dept; BLS",
                sourceUrl: "https://calcivilrights.ca.gov/2024/03/12/on-equal-pay-day-civil-rights-department-releases-new-findings-on-pay-gaps-in-california/",
                screenshot: null,
                actions: [
                    "Support pay transparency",
                    "Advocate for farmworker labor protections for women",
                    "Support women-owned businesses in Watsonville"
                ]
            },
            {
                name: "networks",
                level: 50,
                indicator: "Broadband access",
                value: "Significant digital divide",
                year: 2024,
                target: "Universal broadband access",
                context: "County has 15,745 students without broadband (C- grade). Equal Access Santa Cruz provides subsidized internet via Cruzio/PVUSD partnership. Buena Vista Labor Camp: 160 families connected. Digital literacy and device access also barriers.",
                source: "CA Broadband Report Card; Equal Access SC; Patch",
                sourceUrl: "https://patch.com/california/watsonville/digital-divide-how-wide-watsonville-area",
                screenshot: null,
                actions: [
                    "Support Equal Access Santa Cruz County",
                    "Donate devices to community programs",
                    "Advocate for broadband infrastructure in south county",
                    "Support digital literacy programs at PVUSD"
                ]
            }
        ]
    },
    "city_santa_cruz": {
        name: "City of Santa Cruz",
        population: "~65,000",
        description: "Coastal city, home to UC Santa Cruz. 95% surface water supply. Major housing affordability challenges.",
        ecological: [
            {
                name: "climate change",
                level: 50,
                indicator: "Per capita GHG emissions",
                value: "4.22 MT CO2e/person",
                year: 2019,
                target: "2.51 MT CO2e/person by 2030",
                context: "Down from 5.53 in 2005. Transportation = 69% of emissions. Total: 274,584 MT CO2e.",
                source: "City of Santa Cruz Climate Action Plan 2030",
                sourceUrl: "https://www.santacruzca.gov/government/city-departments/city-manager/climate-action-program/greenhouse-gas-emissions-inventories",
                screenshot: "img/city_santa_cruz_ghg_emissions.png",
                actions: [
                    "Ride the bus, bike, or walk — transportation is 69% of emissions",
                    "Switch to an electric vehicle — City offers EV charging infrastructure",
                    "Electrify your home heating and cooking (replace gas appliances)",
                    "Support the Climate Action Plan 2030 implementation"
                ]
            },
            {
                name: "ocean acidification",
                level: 50,
                indicator: "Coastal ocean pH",
                value: "Data monitored regionally",
                year: 2024,
                target: "Maintain pre-industrial ocean pH",
                context: "Monterey Bay is a major upwelling zone. MBARI monitors ocean chemistry. Local impacts include shellfish and kelp forest health.",
                source: "MBARI / Monterey Bay National Marine Sanctuary",
                sourceUrl: "https://www.mbari.org/",
                screenshot: null,
                actions: [
                    "Reduce personal carbon footprint (CO2 drives acidification)",
                    "Support Monterey Bay National Marine Sanctuary programs",
                    "Participate in coastal cleanup events with Save Our Shores"
                ]
            },
            {
                name: "chemical pollution",
                level: 0,
                indicator: "Pesticide use",
                value: "Minimal in city (county: ~1M lbs/yr)",
                year: 2022,
                target: "Reduce toxic chemical releases",
                context: "City has minimal agricultural land. County-wide: ~1M lbs pesticides/year, 67% fumigants — highest proportion in CA. Concentrated in south county Pajaro Valley.",
                source: "CA Dept of Pesticide Regulation, 2022 Pesticide Use Report",
                sourceUrl: "https://www.cdpr.ca.gov/docs/dept/cac_focus/santa_cruz.htm",
                screenshot: "img/pesticide_use_report_2022.png",
                actions: [
                    "Buy organic and locally grown produce",
                    "Support farmworker health organizations",
                    "Advocate for reduced fumigant use in Pajaro Valley"
                ]
            },
            {
                name: "nitrogen & phosphorus loading",
                level: "NaN",
                indicator: "Nitrogen in groundwater",
                value: "Data not available at city level",
                year: null,
                target: "Below drinking water standard (10 mg/L NO3-N)",
                context: "City water is 95% surface water (San Lorenzo River, Loch Lomond). Pajaro Valley (south county) has severe nitrate contamination — 87% from agriculture. City watershed has lower agricultural intensity.",
                source: "City of Santa Cruz Water Dept",
                sourceUrl: "https://www.santacruzca.gov/Government/City-Departments/Water-Department/Where-Does-Our-Water-Come-From",
                screenshot: null,
                actions: [
                    "Conserve water — protects San Lorenzo River ecosystem",
                    "Properly dispose of household chemicals",
                    "Support watershed restoration programs"
                ]
            },
            {
                name: "freshwater withdrawals",
                level: 50,
                indicator: "Water supply reliability",
                value: "95% surface water dependent",
                year: 2024,
                target: "Sustainable water supply",
                context: "Loch Lomond reservoir holds only one year's supply. Drought vulnerability is significant. City has implemented conservation measures. No desalination plant.",
                source: "City of Santa Cruz Water Department",
                sourceUrl: "https://www.santacruzca.gov/Government/City-Departments/Water-Department/Where-Does-Our-Water-Come-From",
                screenshot: null,
                actions: [
                    "Conserve water — every drop counts with limited reservoir",
                    "Install water-efficient fixtures and drought-tolerant landscaping",
                    "Support City water supply diversification efforts"
                ]
            },
            {
                name: "land conversion",
                level: -50,
                indicator: "Protected land / open space",
                value: "~20% of city area",
                year: 2024,
                target: "Maintain and expand protected areas",
                context: "City provides 1,300+ acres open space + 696 acres across 43 parks (~2,000 acres total). City area: ~10,112 acres. County: 32% protected.",
                source: "City of Santa Cruz Parks & Recreation",
                sourceUrl: "https://www.santacruzca.gov/Government/City-Departments/Parks-Recreation/Parks-Beaches-Open-Spaces",
                screenshot: null,
                actions: [
                    "Volunteer with Land Trust of Santa Cruz County",
                    "Support open space bond measures",
                    "Advocate for infill development over greenfield expansion"
                ]
            },
            {
                name: "biodiversity loss",
                level: 0,
                indicator: "Endemic species and habitat health",
                value: "Global biodiversity hotspot",
                year: 2022,
                target: "Protect all endemic species and habitats",
                context: "1,000+ native plant species, 35 endemic species. Habitats: old-growth redwood, Santa Cruz sandhills, karst caves, coastal prairie, maritime chaparral. CZU fire (2020) impacted mountain habitats.",
                source: "Santa Cruz County RCIS (2022)",
                sourceUrl: "https://www.rcdsantacruz.org/regional-conservation-investment-strategy-rcis",
                screenshot: null,
                actions: [
                    "Support habitat restoration after CZU fire",
                    "Remove invasive species in local parks",
                    "Support the Regional Conservation Investment Strategy"
                ]
            },
            {
                name: "air pollution",
                level: -50,
                indicator: "PM2.5 annual average",
                value: "6.5 \u00b5g/m\u00b3",
                year: 2019,
                target: "WHO guideline: 5 \u00b5g/m\u00b3 (2021 revised)",
                context: "Meets US EPA standard (12) and old WHO guideline (10). Exceeds revised 2021 WHO guideline (5). 2018 was 8.5 due to wildfires. Avg 5.2 unhealthy days/year from wildfires.",
                source: "DataShare SCC / American Lung Association",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=168&localeId=281&localeFilterId=7",
                screenshot: null,
                actions: [
                    "Reduce driving — transportation is biggest local source",
                    "Support wildfire prevention in Santa Cruz Mountains",
                    "Avoid wood burning on spare-the-air days",
                    "Check AQI at iqair.com before outdoor exercise"
                ]
            },
            {
                name: "ozone layer depletion",
                level: -100,
                indicator: "Stratospheric ozone",
                value: "Global issue — recovering",
                year: 2024,
                target: "Full recovery by ~2066",
                context: "Montreal Protocol success story. Ozone layer is recovering globally. Local contribution is minimal. Focus is on proper disposal of old refrigerants/AC units.",
                source: "NOAA / Montreal Protocol",
                sourceUrl: "https://www.epa.gov/ozone-layer-protection",
                screenshot: null,
                actions: [
                    "Properly dispose of old refrigerators and AC units",
                    "Use climate-friendly refrigerants"
                ]
            },
            {
                name: "waste & materials",
                level: 0,
                indicator: "Landfill diversion rate",
                value: "~75% diverted (~25% to landfill)",
                year: 2024,
                target: "Zero Waste (long-term county goal)",
                context: "County-wide 75% diversion target (set 2005, met by 2010). City operates Resource Recovery Facility at 605 Dimeo Lane. SB 1383 (2022) requires curbside organics collection. City-specific diversion rate not separately published from county.",
                source: "City of Santa Cruz Resource Recovery; Santa Cruz County Public Works",
                sourceUrl: "https://www.santacruzca.gov/Government/City-Departments/Public-Works/Resource-Recovery",
                screenshot: null,
                actions: [
                    "Use the green bin — compost food scraps and yard waste (SB 1383)",
                    "Repair and reuse before replacing — visit the Fixit Clinic",
                    "Refuse single-use plastics; bring reusable bags and containers",
                    "Donate usable items to Grey Bears, Goodwill, or local thrift stores"
                ]
            }
        ],
        social: [
            {
                name: "food",
                level: 75,
                indicator: "Food insecurity rate",
                value: "10–33% food insecure (varies by measure)",
                year: 2023,
                target: "Below 10% food insecurity",
                context: "Food insecurity ranges from 10% (County Vision goal) to 12.4% (DataShare SCC, 2023) to 33% (Second Harvest estimate). Second Harvest serves 70,000+/month, surging to 100,000 during federal cuts. $2M+ in federal funding lost in 2025. County declared food insecurity emergency.",
                source: "DataShare SCC; Second Harvest Food Bank; County Vision Santa Cruz",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=2107&localeId=281",
                screenshot: null,
                actions: [
                    "Donate to Second Harvest Food Bank Santa Cruz County",
                    "Volunteer at local food distribution sites",
                    "Support CalFresh enrollment outreach",
                    "Advocate for federal food assistance funding"
                ]
            },
            {
                name: "health",
                level: -25,
                indicator: "Uninsured rate",
                value: "3.73% uninsured (city, ages 18-64)",
                year: 2023,
                target: "Universal coverage",
                context: "City uninsured rate 3.73% for ages 18-64 (excludes Medicare-eligible 65+), well below state average. MediCruz program covers undocumented residents. However, 21,000 county residents could lose coverage by 2028 due to Medicaid cuts. Life expectancy is above state average.",
                source: "Data USA / Census ACS; Santa Cruz Local",
                sourceUrl: "https://datausa.io/profile/geo/santa-cruz-ca#:~:text=Uninsured%20People%20*%203.73%25",
                screenshot: null,
                actions: [
                    "Support MediCruz specialty program for uninsured residents",
                    "Help neighbors enroll in Covered California",
                    "Advocate against Medicaid cuts at state and federal level",
                    "Support community health centers"
                ]
            },
            {
                name: "education",
                level: -25,
                indicator: "High school graduation rate",
                value: "93.45% (city average across 5 schools)",
                year: 2024,
                target: "100% graduation; equity across schools",
                context: "City-wide average 93.45%. By school: Santa Cruz High 96% (1,104 students), Pacific Collegiate 94% (340), Ark Independent 93% (52), Harbor High 92% (1,040), Costanoa Continuation 76% (87). Achievement gap: continuation school significantly lower. Math proficiency 49% (vs 33% state avg), reading 68% (vs 47% state avg).",
                source: "US News; CA Dept of Education CAASPP",
                sourceUrl: "https://www.usnews.com/education/best-high-schools/california/rankings/santa-cruz",
                screenshot: null,
                actions: [
                    "Volunteer as a tutor or mentor in local schools",
                    "Support after-school programs for underserved students",
                    "Advocate for equitable school funding",
                    "Donate to Santa Cruz Education Foundation"
                ]
            },
            {
                name: "income & work",
                level: 50,
                indicator: "Poverty rate",
                value: "17% below poverty line",
                year: 2020,
                target: "Below 10%",
                context: "17% of persons in poverty (Census QuickFacts, 2020). Median household income: $111,427 (2023). Extreme income polarization between tech/university workers and service sector. 5.5% of families in poverty. High cost of living drives poverty rate above national average despite high median income.",
                source: "U.S. Census Bureau QuickFacts",
                sourceUrl: "https://www.census.gov/quickfacts/fact/table/santacruzcitycalifornia/INC110223",
                screenshot: null,
                actions: [
                    "Support living wage campaigns",
                    "Buy from locally owned businesses",
                    "Support workforce development programs",
                    "Advocate for affordable childcare"
                ]
            },
            {
                name: "housing",
                level: 125,
                indicator: "Homelessness & housing cost burden",
                value: "1,850 unhoused; 19.5% cost-burdened (county)",
                year: 2024,
                target: "Functional zero homelessness; <30% rent burden",
                context: "2024 PIT count: 1,850 unhoused (sheltered + unsheltered) city-wide. 19.5% of county households cost-burdened (>30% income on housing, DataShare SCC 2023). 60% of city residents are renters. Median rent above $3,000/mo. Rents up 24.4% since 2019. Santa Cruz has the highest per-capita homelessness rate in the nation.",
                source: "City of Santa Cruz 2024 PIT Count; DataShare SCC",
                sourceUrl: "https://www.santacruzca.gov/files/assets/city/v/1/cmo/documents/homelessness/2024pitcount_executive-summary.pdf",
                screenshot: null,
                actions: [
                    "Support Housing Matters Santa Cruz (formerly Homeless Services Center)",
                    "Advocate for more affordable housing development",
                    "Support tenant protection policies",
                    "Volunteer with local shelter programs",
                    "Push for accessory dwelling unit (ADU) incentives"
                ]
            },
            {
                name: "water & sanitation",
                level: -50,
                indicator: "Drinking water quality",
                value: "Meets all EPA & state standards (detailed data pending)",
                year: 2024,
                target: "Full compliance with all drinking water standards",
                context: "Santa Cruz Water Dept serves ~96,000 people. 95% surface water. Meets all federal and state standards. Detailed system-level compliance data not yet available online — contact WaterQuality@santacruzca.gov or (831) 420-5480 for % of people receiving water from non-compliant systems. $140M Pure Water Soquel project for mid-county.",
                source: "City of Santa Cruz Water Department 2024 Annual Water Quality Report",
                sourceUrl: "https://www.santacruzca.gov/files/assets/city/v/1/wt/documents/water-quality-reports/santa-cruz-water-department-wqr-2024-v2.pdf",
                screenshot: null,
                actions: [
                    "Conserve water to protect the San Lorenzo River",
                    "Properly dispose of household chemicals — don't pour down drains",
                    "Support watershed protection programs",
                    "Check your annual water quality report"
                ]
            },
            {
                name: "energy",
                level: 0,
                indicator: "Electricity cost & renewables",
                value: "33.5\u00a2/kWh; 51% renewable grid",
                year: 2025,
                target: "100% clean energy; affordable rates",
                context: "Average residential rate: 33.5\u00a2/kWh (PG&E). Average bill: ~$321/mo. California grid is 51% renewable as of 2025. 3 Clean Energy (3CE) offers 100% renewable option. High rates create energy burden for low-income households.",
                source: "EnergySage; PG&E; California Energy Commission",
                sourceUrl: "https://www.energysage.com/local-data/electricity-cost/ca/santa-cruz-county/santa-cruz/",
                screenshot: null,
                actions: [
                    "Switch to 3CE Prime for 100% renewable electricity",
                    "Apply for CARE/FERA low-income rate discounts",
                    "Install solar panels — strong local solar potential",
                    "Weatherize your home to reduce energy costs"
                ]
            },
            {
                name: "social equity",
                level: 75,
                indicator: "Gini coefficient (income inequality)",
                value: "0.483 (county-level)",
                year: 2023,
                target: "Below 0.30 (CA Doughnut target)",
                context: "Gini of 0.483 — well above the California Doughnut target of <0.30 (where 0 = perfect equality, 1 = all income to one person). California state index is 0.65. Racial Equity Index Inclusion Score: 54 (county) vs CA target of 100. Tech/university incomes vs service/agricultural worker wages create extreme polarization.",
                source: "DataShare SCC; National Equity Atlas",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=288&localeId=281",
                screenshot: null,
                actions: [
                    "Support living wage initiatives",
                    "Advocate for progressive local tax policies",
                    "Support community land trusts",
                    "Buy from worker-owned cooperatives"
                ]
            },
            {
                name: "peace & justice",
                level: 50,
                indicator: "Violent crime rate per 100K",
                value: "357 per 100K residents",
                year: 2023,
                target: "Below national average (~380/100K)",
                context: "Violent crime rate of 357 per 100K (DataShare SCC). Slightly below the national average (~380/100K) but property crime remains 2x national average. Overall: 1 in 29 chance of being a crime victim. Safer than only 11% of CA cities. Violent crime decreased 8% year-over-year.",
                source: "DataShare SCC; FBI UCR; NeighborhoodScout",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=522&localeId=281",
                screenshot: null,
                actions: [
                    "Support community-based violence prevention programs",
                    "Advocate for restorative justice initiatives",
                    "Support Barrios Unidos community programs",
                    "Engage with neighborhood watch programs"
                ]
            },
            {
                name: "political voice",
                level: -50,
                indicator: "Voter participation",
                value: "75.5% voter participation (DataShare SCC)",
                year: 2023,
                target: "Above 80% in general elections",
                context: "Voter participation 75.5% (DataShare SCC). County general election turnout: 81.8% in Nov 2024, down from 86.1% in 2020. Primary turnout: 46% (4th highest in CA). Strong civic engagement tradition. Lower off-cycle participation drags the average down.",
                source: "DataShare SCC; Santa Cruz County Elections; CA Secretary of State",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=11303&localeId=281",
                screenshot: null,
                actions: [
                    "Register to vote and encourage others",
                    "Attend City Council meetings",
                    "Join a local community board or commission",
                    "Support voter registration drives in underrepresented communities"
                ]
            },
            {
                name: "gender equality",
                level: 50,
                indicator: "Gender pay ratio",
                value: "Women earn 70% of men's median wage (full-time)",
                year: 2023,
                target: "Pay equity (1:1 ratio)",
                context: "Women earn 70% of men's median wage for full-time year-round work (Neilsberg). Larger gap than broader measures suggest — driven by occupational segregation. Santa Cruz is 2nd CA city to pass equal pay in sports competitions. County Board adopted CEDAW resolution (Feb 2024). Racial Equity Index Inclusion Score: 54 vs CA target of 100.",
                source: "Neilsberg; National Equity Atlas; DataShare SCC",
                sourceUrl: "https://www.neilsberg.com/insights/santa-cruz-ca-income-by-gender/",
                screenshot: null,
                actions: [
                    "Support pay transparency policies",
                    "Advocate for salary history ban enforcement",
                    "Support women-owned businesses",
                    "Push for CEDAW implementation at city level"
                ]
            },
            {
                name: "networks",
                level: 25,
                indicator: "Broadband access & mobility",
                value: "~16,000 households lack internet; 38% drive alone",
                year: 2024,
                target: "Universal broadband; reduce single-occupancy driving",
                context: "~16,000 households without adequate internet (C- on CA Broadband Report Card). Equal Access SC provides $15/mo internet. $10M state grant for rural fiber. 38% of commuters drive alone (DataShare SCC) — lower than national average but opportunity for improvement via transit and bike infrastructure.",
                source: "Equal Access Santa Cruz; DataShare SCC; CA Broadband Report Card",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=2367&localeId=281&comparisonId=7127",
                screenshot: null,
                actions: [
                    "Support Equal Access Santa Cruz for low-cost internet",
                    "Donate devices to community technology programs",
                    "Advocate for municipal broadband infrastructure",
                    "Support digital literacy programs at libraries"
                ]
            }
        ]
    },
    "santa_cruz_county": {
        name: "Santa Cruz County",
        population: "~270,000",
        description: "Includes unincorporated areas. Major agriculture in Pajaro Valley. 32% protected land. Biodiversity hotspot.",
        ecological: [
            {
                name: "climate change",
                level: 50,
                indicator: "Total GHG emissions",
                value: "394,748 MT CO2e (~2.56/capita est.)",
                year: 2018,
                target: "40% below 1990 levels by 2030 (SB 32)",
                context: "Down 27% from 2005 baseline (539,333 MT). Transportation 50.8%, Residential 26.3%, Commercial 13.9%, Waste 8.3%. Already met AB 32 2020 target.",
                source: "County of Santa Cruz 2018 GHG Inventory (AMBAG)",
                sourceUrl: "https://www.santacruzcountyca.gov/Portals/0/County/GSD/Commission%20on%20the%20Environment/Documents%20Library/Attachment%20B%20Santa%20Cruz%20County%20Draft%202018%20Community-wide%20GHG%20Inventory.pdf",
                screenshot: "img/county_ghg_executive_summary.png",
                actions: [
                    "Reduce vehicle miles traveled — transportation is 51% of emissions",
                    "Switch to 3CE Prime for 100% renewable electricity",
                    "Electrify home heating and cooking",
                    "Support the County Climate Action and Adaptation Plan"
                ]
            },
            {
                name: "ocean acidification",
                level: 50,
                indicator: "Coastal ocean pH",
                value: "Monitored regionally",
                year: 2024,
                target: "Maintain pre-industrial pH",
                context: "Monterey Bay upwelling zone. Kelp forests and marine ecosystems under stress.",
                source: "MBARI",
                sourceUrl: "https://www.mbari.org/",
                screenshot: null,
                actions: ["Reduce carbon footprint", "Support marine sanctuary programs"]
            },
            {
                name: "chemical pollution",
                level: 100,
                indicator: "Pesticide use",
                value: "~1 million lbs/year, 67% fumigants",
                year: 2022,
                target: "Reduce toxic pesticide use",
                context: "Highest proportion of fumigant gases of any CA county. Concentrated in Pajaro Valley agriculture (strawberries, lettuce). Environmental justice concern for farmworkers.",
                source: "CA DPR 2022 Pesticide Use Report",
                sourceUrl: "https://www.cdpr.ca.gov/wp-content/uploads/2024/12/2022_santa_cruz_commodity.pdf",
                screenshot: "img/pesticide_use_report_2022.png",
                actions: [
                    "Buy organic produce — especially strawberries",
                    "Support transition to less toxic pest management",
                    "Advocate for farmworker health protections",
                    "Support organizations like Pesticide Action Network"
                ]
            },
            {
                name: "nitrogen & phosphorus loading",
                level: 100,
                indicator: "Groundwater nitrate (Pajaro Valley)",
                value: "87% from agricultural sources",
                year: 2015,
                target: "Below 10 mg/L NO3-N",
                context: "Pajaro Valley groundwater severely contaminated. Sources: 87% agricultural, 5% stream runoff, 4% sewer, 4% septic. Seawater intrusion also a concern.",
                source: "Pajaro Valley Water Management Agency",
                sourceUrl: "https://www.pvwater.org/",
                screenshot: null,
                actions: [
                    "Support PVWMA groundwater sustainability efforts",
                    "Advocate for agricultural best management practices",
                    "Support recycled water programs"
                ]
            },
            {
                name: "freshwater withdrawals",
                level: 50,
                indicator: "Groundwater overdraft",
                value: "Pajaro Valley basin overdrafted",
                year: 2024,
                target: "Sustainable yield",
                context: "Pajaro Valley groundwater basin is critically overdrafted. Seawater intrusion advancing. North county surface water also drought-vulnerable.",
                source: "PVWMA; City of Santa Cruz Water Dept",
                sourceUrl: "https://www.pvwater.org/",
                screenshot: null,
                actions: ["Conserve water", "Support groundwater recharge projects", "Support recycled water infrastructure"]
            },
            {
                name: "land conversion",
                level: -50,
                indicator: "Protected land",
                value: "32%",
                year: 2022,
                target: "30x30 (30% by 2030) — already exceeded",
                context: "Second only to San Mateo in the region. Includes state parks, county parks, land trust holdings, UCSC natural reserves.",
                source: "Santa Cruz County RCIS (2022)",
                sourceUrl: "https://www.rcdsantacruz.org/regional-conservation-investment-strategy-rcis",
                screenshot: null,
                actions: ["Support Land Trust of Santa Cruz County", "Advocate for conservation easements"]
            },
            {
                name: "biodiversity loss",
                level: 0,
                indicator: "Endemic species protection",
                value: "35 endemic species, 1,000+ native plants",
                year: 2022,
                target: "Protect all endemic species",
                context: "Global biodiversity hotspot. 17 plant species found only in this county. Habitats recovering from CZU fire.",
                source: "Santa Cruz County RCIS",
                sourceUrl: "https://www.rcdsantacruz.org/regional-conservation-investment-strategy-rcis",
                screenshot: null,
                actions: ["Volunteer for habitat restoration", "Report invasive species", "Support RCIS implementation"]
            },
            {
                name: "air pollution",
                level: -50,
                indicator: "PM2.5 annual average",
                value: "6.5 \u00b5g/m\u00b3",
                year: 2019,
                target: "WHO 2021 guideline: 5 \u00b5g/m\u00b3",
                context: "Generally good air quality. Wildfire smoke is primary concern. 2018: 8.5 \u00b5g/m\u00b3 due to fires.",
                source: "DataShare SCC",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=168&localeId=281&localeFilterId=7",
                screenshot: null,
                actions: ["Support wildfire prevention", "Reduce driving", "Avoid burning wood"]
            },
            {
                name: "ozone layer depletion",
                level: -100,
                indicator: "Stratospheric ozone",
                value: "Recovering globally",
                year: 2024,
                target: "Full recovery ~2066",
                context: "Montreal Protocol success. Local action: proper refrigerant disposal.",
                source: "NOAA",
                sourceUrl: "https://www.epa.gov/ozone-layer-protection",
                screenshot: null,
                actions: ["Properly dispose of old refrigerants"]
            },
            {
                name: "waste & materials",
                level: 0,
                indicator: "Landfill diversion rate",
                value: "~75% diverted (~25% to landfill)",
                year: 2024,
                target: "Zero Waste (long-term goal)",
                context: "County met 75% diversion target (set 2005). Buena Vista Drive Sanitary Landfill is primary facility. Solid waste = 8.3% of county GHG (32,700 MT CO2e in 2018). SB 1383 organics collection required.",
                source: "Santa Cruz County Public Works; CalRecycle",
                sourceUrl: "https://cdi.santacruzcountyca.gov/PublicWorks/RecyclingSolidWaste.aspx",
                screenshot: null,
                actions: [
                    "Compost food and yard waste in the green bin",
                    "Reduce single-use packaging; choose bulk and refill",
                    "Donate or repair before discarding",
                    "Support extended landfill life through diversion"
                ]
            }
        ],
        social: [
            {
                name: "food", level: 75, indicator: "Food insecurity rate",
                value: "~93,000 residents at risk (~40,900 households)",
                year: 2025, target: "Zero hunger",
                context: "1 in 3 county residents food insecure. Households can purchase ~54% of needed meals. Second Harvest serves 70K+/month, surging to 100K during 2025 federal cuts. $2M+ federal funding lost. SNAP gap worst in central SC, Capitola, Watsonville.",
                source: "Blum Center / UCSC; Second Harvest Food Bank",
                sourceUrl: "https://news.ucsc.edu/2019/11/blum-foodinsecurity.html",
                screenshot: null,
                actions: ["Donate to Second Harvest Food Bank", "Support CalFresh enrollment outreach", "Volunteer at food distribution sites"]
            },
            {
                name: "health", level: 0, indicator: "Uninsured rate",
                value: "5.3% uninsured (county)",
                year: 2023, target: "Universal coverage",
                context: "County uninsured rate 5.3%, down from 5.4% in 2022. Wide variation: SC city 3.7% vs Watsonville 9.8%. 21,000 could lose coverage by 2028 due to Medicaid cuts.",
                source: "Census ACS via Data USA",
                sourceUrl: "https://datausa.io/profile/geo/santa-cruz-county-ca/",
                screenshot: null,
                actions: ["Support Medi-Cal enrollment", "Advocate against Medicaid cuts", "Support community health centers"]
            },
            {
                name: "education", level: 25, indicator: "HS graduation rate",
                value: "Varies: SC High 97% vs PVUSD 79%",
                year: 2024, target: "87%+ across all districts",
                context: "Massive north-south education gap. SC city schools far exceed state averages. PVUSD (Watsonville): 79% graduation, 17% math proficiency, 27% reading. COE district: 60%. Achievement gap mirrors income/equity disparities.",
                source: "Public School Review; CA Dept of Education",
                sourceUrl: "https://www.publicschoolreview.com/california/watsonville/high",
                screenshot: null,
                actions: ["Support tutoring programs in south county", "Advocate for equitable school funding", "Support bilingual education"]
            },
            {
                name: "income & work", level: 50, indicator: "Median household income",
                value: "$109,266 (county median)",
                year: 2023, target: "Living wage for all; reduce poverty",
                context: "County median $109K, but extreme variation: SC city $111K vs Watsonville $75K. Cost of living very high. ALICE households (above poverty but can't afford basics) are a significant uncounted population.",
                source: "Census ACS via Data USA",
                sourceUrl: "https://datausa.io/profile/geo/santa-cruz-county-ca/",
                screenshot: null,
                actions: ["Support living wage campaigns", "Push for ALICE data collection", "Support workforce development"]
            },
            {
                name: "housing", level: 125, indicator: "Housing cost burden",
                value: "Highest per-capita homelessness nationally",
                year: 2024, target: "Functional zero homelessness; <30% rent burden",
                context: "Rents up 24.4% since 2019. 2024 PIT: 1,850 unhoused county-wide (down to 1,473 in 2025). 57% of renters cost-burdened. Highest per-capita homelessness rate in the nation.",
                source: "CHPC Housing Needs Report; City PIT Count",
                sourceUrl: "https://chpc.net/wp-content/uploads/2024/05/Santa-Cruz_Housing_Report.pdf",
                screenshot: null,
                actions: ["Support Housing Matters", "Advocate for affordable housing", "Support tenant protections"]
            },
            {
                name: "water & sanitation", level: 25, indicator: "Water quality",
                value: "Mixed: north good, south contaminated",
                year: 2024, target: "All drinking water meets standards",
                context: "North county (SC city): meets all EPA/state standards, 95% surface water. South county (Watsonville): Pajaro Valley groundwater severely contaminated with nitrate and seawater intrusion. Chromium-6 concerns mid-county.",
                source: "SC Water Dept; PVWMA; Santa Cruz Local",
                sourceUrl: "https://santacruzlocal.org/2026/03/01/county-residents-notified-of-erin-brockovich-chemical-in-drinking-water/",
                screenshot: null,
                actions: ["Conserve water", "Support PVWMA groundwater projects", "Check water quality reports"]
            },
            {
                name: "energy", level: 0, indicator: "Electricity & renewables",
                value: "51% renewable grid; 3CE available",
                year: 2025, target: "100% clean energy; affordable rates",
                context: "CA grid 51% renewable. 3CE offers 100% renewable option for all county residents. Average rate 33.5 cents/kWh. Energy burden higher in south county where incomes are lower.",
                source: "EnergySage; 3CE; CA Energy Commission",
                sourceUrl: "https://3ce.org/",
                screenshot: null,
                actions: ["Switch to 3CE Prime", "Apply for CARE/FERA discounts", "Support community solar"]
            },
            {
                name: "social equity", level: 75, indicator: "Gini coefficient",
                value: "0.50 (severe inequality threshold)",
                year: 2021, target: "Below 0.40",
                context: "Gini of 0.50 at threshold of severe inequality. North-south divide: SC city median $111K vs Watsonville $75K. Tech/university incomes vs agricultural/service wages. CalEnviroScreen flags south county for environmental injustice.",
                source: "Census ACS; DataShare SCC",
                sourceUrl: "https://www.datasharescc.org/indicators/index/view?indicatorId=288&localeId=281",
                screenshot: null,
                actions: ["Support living wage initiatives", "Advocate for equitable tax policies", "Support environmental justice"]
            },
            {
                name: "peace & justice", level: 50, indicator: "Crime rates",
                value: "SC city: 6.3/1K violent; Watsonville improving",
                year: 2024, target: "Below national average",
                context: "SC city violent crime 1.7x national avg. Watsonville: 23% crime decline in 2024, 33% since 2020. Property crime varies significantly by area. Unincorporated area data from Sheriff's office.",
                source: "FBI UCR; NeighborhoodScout; Watsonville PD",
                sourceUrl: "https://www.neighborhoodscout.com/ca/santa-cruz/crime",
                screenshot: null,
                actions: ["Support community violence prevention", "Support Barrios Unidos", "Engage with neighborhood programs"]
            },
            {
                name: "political voice", level: -50, indicator: "Voter turnout",
                value: "81.8% (Nov 2024 general)",
                year: 2024, target: "Above 80% in general elections",
                context: "County-wide 81.8% turnout (136,505 votes), down from 86.1% in 2020. Primary: 46% (4th highest in CA). South county historically lower turnout. Strong civic engagement tradition overall.",
                source: "CA Secretary of State; Santa Cruz County Elections",
                sourceUrl: "https://admin.cdn.sos.ca.gov/elections/sov/2024-general/sov/03-voter-participation-stats-by-county.pdf",
                screenshot: null,
                actions: ["Support voter registration in underrepresented communities", "Attend Board of Supervisors meetings"]
            },
            {
                name: "gender equality", level: 25, indicator: "Gender pay ratio",
                value: "Women earn 85 cents per $1 (county)",
                year: 2024, target: "Pay equity (1:1)",
                context: "County wage ratio 0.85. SC city passed equal pay in sports. County Board adopted CEDAW resolution (Feb 2024). Women's Commission partnering with DataShare SCC on 6 gender equity categories. Gap wider for women of color.",
                source: "CA Civil Rights Dept; DataShare SCC Women's Wellbeing 2024",
                sourceUrl: "https://www.datasharescc.org/tiles/index/display?alias=Womens_Wellbeing_SCCounty2024",
                screenshot: null,
                actions: ["Support pay transparency", "Push for CEDAW implementation", "Support Women's Commission"]
            },
            {
                name: "networks", level: 25, indicator: "Broadband access",
                value: "C- grade; ~16,000 households lack internet",
                year: 2024, target: "Universal broadband access",
                context: "15,745 students without broadband. Equal Access SC provides $15/mo internet. $500K county grant to Cruzio. $10M state grant for rural fiber. Digital divide worst in south county and rural areas.",
                source: "CA Broadband Report Card; Equal Access SC",
                sourceUrl: "https://equalaccesssantacruz.com/",
                screenshot: null,
                actions: ["Support Equal Access Santa Cruz", "Advocate for municipal broadband", "Donate devices"]
            }
        ]
    }
};
