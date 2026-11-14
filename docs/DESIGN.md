# Visual design and accessibility

FireWatch uses a near-full-screen map with a floating header, three task tabs, compact map tools and a bottom month timeline. Desktop evidence opens at the left. Mobile details use a collapsible bottom sheet; it starts collapsed to preserve the map. The handle is both touch- and keyboard-operable. The legacy analysis workspace remains available for detailed calendars, imports and model explanations.

| Role | Palette and redundant encoding |
|---|---|
| Foundation | Evergreen #102A22; light sage #EDF6EF; translucent tint, bounded blur and fine highlight |
| Active action | Mint #6EE7B7 on dark surfaces; green #166B4F on light surfaces; selected fill and text |
| MODIS | Warm amber circles |
| VIIRS | Magenta diamonds at detailed zoom |
| Evidence | Lavender candidate outline with status text; mint selected-cell outline |
| Unknown coverage | Gray hatching and an explicit label |
| Planning | Ordered pale ochre-to-terracotta ramp, numeric relative index |

Related greens keep the interface coherent with the forest imagery. Warm amber separates heat observations from interface controls. Magenta distinguishes the second sensor, while shapes retain that distinction without color perception. Lavender marks imagery candidates without implying a verified wildfire. Color is reinforced by words, shapes, borders or hatching.

Dark glass opacity is 0.72; light is 0.76. Dense evidence details and legends receive stronger tints. Secondary text was adjusted to #DCEBE2 (dark theme) and #284335 (light) after worst-case black/white compositing checks. Primary action contrast is 10.01:1 for dark text on mint and 5.94:1 for light text on deep green. Secondary text in a single glass/control layer clears 4.5:1 using the final colors. Real maps, nested transparency and antialiasing still require visual checks; this is not a formal WCAG certification.

The Solid panels setting uses opaque fills; unsupported backdrop-filter receives an opaque fallback. Reduced-motion CSS removes transitions/animation. Visible focus outlines, semantic form labels, keyboard-accessible sample and review tables, and a focus-contained analysis dialog supplement map gestures. Safe-area offsets and dynamic viewport height are used on mobile. Myanmar month labels are explicit rather than relying on browser locale availability.

Verified layouts and limits are recorded in VALIDATION_V2.md. Physical iOS devices, assistive-technology certification and formal color-vision simulation were not available in this environment.

