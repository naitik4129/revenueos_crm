# MOTM Technologies artwork

The supplied logo was reconstructed as transparent SVG artwork: the angular growth mark,
red-to-orange gradient, geometric company lettering and “Igniting Industrial Growth” tagline.
The lettering is outlined, so the wordmark does not depend on installed fonts.

- `motm-mark.svg`: compact symbol for navigation and app states.
- `motm-wordmark.svg`: company lettering; the shared `BrandLogo` component adapts it for dark backgrounds.
- `motm-logo.svg`: standalone full logo with the tagline, for light backgrounds.
- `motm-icon-512.png`: square icon with an ivory background.

The application uses `src/components/common/brand-logo.tsx` for consistent spacing,
accessible labels and responsive variants. Primary interface colors are in `src/styles.css`.
The full signature appears on both sign-in screens; compact branding appears in the sidebar,
workspace and admin header; the mark appears in the mobile header and loading/error states.

Browser icons live at `/favicon.svg` and `/favicon.ico`; the Apple home-screen icon is
`/apple-touch-icon.png`. The icon uses only the symbol to remain readable at small sizes.
The ICO contains 16, 32, 48 and 256 pixel images. Both HTML and router metadata use a versioned
icon URL to refresh the previous browser favicon.

To regenerate the raster icons from `motm-mark.svg` on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File Frontend/scripts/generate-brand-icons.ps1
```

The SVG favicon embeds the mark with a rounded ivory background; keep it in sync if the
master symbol changes. The standalone full logo also embeds the mark and wordmark.
