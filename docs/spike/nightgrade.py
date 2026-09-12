"""Turn a daytime street frame into a plausible night frame, offline.

Orbis takes its lighting from the seed image and ignores a "night" prompt
(docs/reactor-findings.md, Q1), so the seed has to already be dark. This is
the zero-dependency version of that conversion: no extra API, no key, runs in
milliseconds. It keeps geometry untouched, which is the whole point — the
block still has to be recognisable.

usage: python nightgrade.py <in.jpg> <out.jpg>
"""

import sys

import numpy as np
from PIL import Image, ImageFilter

# Sodium-vapour cast, as a linear RGB multiplier.
SODIUM = np.array([1.25, 0.82, 0.45])
SKY = np.array([10, 13, 26]) / 255.0  # near-black navy
BASE_EXPOSURE = 0.16
HIGHLIGHT_KNEE = 0.72


def main():
    source, target = sys.argv[1], sys.argv[2]
    # Orbis loses the block when the graded seed is too dark to show structure
    # (docs/reactor-findings.md, Q1), so exposure is a tunable, not a constant.
    exposure = float(sys.argv[3]) if len(sys.argv) > 3 else BASE_EXPOSURE
    image = Image.open(source).convert("RGB")
    width, height = image.size
    rgb = np.asarray(image).astype(np.float32) / 255.0

    luma = rgb @ np.array([0.2126, 0.7152, 0.0722])

    # 1. Sky: bright upper-frame pixels, replaced rather than darkened — a
    #    merely dim sky still reads as dusk, not night. Blue-dominant catches
    #    a clear sky; low saturation catches an overcast one, which is most of
    #    SF and which a blueness test alone misses entirely (that failure is
    #    what made the first block-B seed unusable).
    rows = np.linspace(0.0, 1.0, height)[:, None]
    blueness = rgb[:, :, 2] - (rgb[:, :, 0] + rgb[:, :, 1]) / 2.0
    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    sky_like = (blueness > 0.03) | (saturation < 0.20)
    sky_mask = sky_like & (luma > 0.42) & (rows < 0.62)
    sky_mask = np.asarray(
        Image.fromarray((sky_mask * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(3)
        ),
        dtype=np.float32,
    )[:, :, None] / 255.0

    # 2. Global night exposure with a lifted toe, so shadows go black but do
    #    not posterise.
    night = np.power(np.clip(rgb, 0.0, 1.0), 1.45) * exposure
    night = night * SODIUM

    # 3. Keep the brightest things bright — windows, signs, the sky glow at the
    #    end of the street become the light sources.
    highlight = np.clip((luma - HIGHLIGHT_KNEE) / (1.0 - HIGHLIGHT_KNEE), 0.0, 1.0)
    glow = np.asarray(
        Image.fromarray((highlight * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(9)
        ),
        dtype=np.float32,
    )[:, :, None] / 255.0
    lamp = np.array([1.0, 0.72, 0.36])
    night = night + glow * 0.55 * lamp + highlight[:, :, None] * 0.30 * lamp

    # 4. Composite the sky last so glow does not bleed a daylit sky back in.
    night = night * (1.0 - sky_mask) + SKY * sky_mask

    # 5. Wet asphalt: the lower-centre road picks up a vertical smear of the
    #    lamp colour, which is what sells "night street" more than darkness.
    road = np.clip((rows - 0.62) / 0.38, 0.0, 1.0)
    columns = np.linspace(-1.0, 1.0, width)[None, :]
    sheen = np.exp(-(columns**2) / 0.10) * road
    night = night + sheen[:, :, None] * 0.16 * lamp

    out = np.clip(night, 0.0, 1.0)
    Image.fromarray((out * 255).astype(np.uint8)).save(target, "JPEG", quality=93)
    print(f"wrote {target} (mean luma {float((out @ [0.2126,0.7152,0.0722]).mean()):.3f})")


main()
