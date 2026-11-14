# Rebuild v2 demo for judges

“FireWatch compares NASA MODIS and VIIRS observations across Bago Yoma on one five-kilometre grid and calendar. It now lets us inspect independent satellite images beside those observations and explicitly shows where evidence is missing.”

1. Open Hotspots. Explain amber MODIS circles and magenta VIIRS diamonds, the 2015–2025 archive, and the approximate study boundary. Change the month or sensor. The observations are heat detections, not confirmed wildfire incidents.
2. Open Burn evidence. The selected month is retained. Choose 28_398 / March 2025 or 25_400 / March 2024. Compare the real Sentinel-2 images, dates and clear-area percentage. Lavender polygons are unreviewed dNBR candidates. Hotspot points and MODIS burned-area cross-checks stay hidden until a label is locked.
3. State the actual status: 60 sampled cell-months, 12 image pairs acquired, 0 human reviews locked, all VIIRS science-swath coverage unknown pending Earthdata access. Do not narrate an unreviewed candidate as a verified fire. Show the review fields and exports without submitting a demonstration label into the scientific dataset.
4. Open Planning outlook. Show the relative seasonal index, 36/48-month horizon and sensitivity scenarios. Explain that the pattern repeats and is not an ignition forecast or a probability.
5. Open Data & model details from the menu. The historical Random Forest accuracy is about 91.6%, F1 about 0.755 on 14,136 held-out cell-months of recorded VIIRS detections. The seasonal baseline is selected by validation Brier score. Independent imagery agreement remains pending.

The green glass layout keeps most of the map visible; warm detection colors stand out against the cool forest palette. Color is reinforced by sensor shapes, candidate outlines, coverage hatching and text.

The original walkthrough follows for the retained analysis workspace.

# Five-minute hackathon demonstration

1. Open **Overview**. Explain Bago Region versus the approximate Bago Yoma study envelope. Identify real NASA data, dates and unknown observation coverage.
2. Select March 2024. Zoom in so MODIS orange circles and VIIRS magenta diamonds are visible. Open a table row: original sensor confidence, UTC/Yangon time, FRP and provenance remain available.
3. Open **Burning calendar**. Compare 2015–2025 and switch between raw and adjusted activity. Click a month to update the map. Explain that a thermal detection is not one wildfire.
4. Enable **Adjusted historical grid**. Explain the training-era monthly MODIS-to-VIIRS adjustment and its limits; download grid/monthly CSV and the AOI.
5. Open **Model & data**. Show actual held-out 2024–2025 scores. Random Forest F1 is about 0.755; the seasonal baseline is displayed for planning because validation Brier error was better. Explain the missing observation denominator.
6. Open **Future risk**. Select 36 or 48 months; move across the same season in different years. The repeated pattern is intentional. Compare sensitivity scenarios and bootstrap spread. Read the non-operational-warning label.
7. Switch to **မြန်မာ** and dark mode. Show an import or draw a new AOI: the original fitted model/calibration becomes unavailable rather than making unsupported new-AOI predictions.
8. Finish with **Methodology** and the source download. State that NASA data were used; authenticated GEE covariates/coverage masks are the next scientific step, not completed work.

Do not say “92% accurate wildfire prediction,” “one marker equals one fire,” “NASA-validated model,” or “exact fires three years ahead.” A defensible phrase is: “On withheld 2024–2025 cell-months, the model identified patterns of recorded satellite activity; planning maps show exploratory relative seasonal susceptibility.”
