from datetime import datetime

import numpy as np
from PIL import Image

from conditions import SF_TZ, ConditionModel, _perpendicular, clock
from hours import is_open
from imagery import OUT_H, OUT_W, crop_equirect, fit_16_9

SAT_11PM = datetime(2026, 9, 12, 23, 0)  # a Saturday
MON_10AM = datetime(2026, 9, 14, 10, 0)


def test_opening_hours():
    assert is_open("24/7", SAT_11PM) is True
    assert is_open("Mo-Fr 09:00-17:00", MON_10AM) is True
    assert is_open("Mo-Fr 09:00-17:00", SAT_11PM) is False
    assert is_open("Mo-Su 18:00-02:00", SAT_11PM) is True
    assert is_open("Fr 18:00-02:00", datetime(2026, 9, 12, 1, 0)) is True  # Friday night into Saturday
    assert is_open("Mo-Fr 09:00-17:00; PH off", MON_10AM) is True
    assert is_open("sunrise-sunset", MON_10AM) is None
    assert is_open(None, MON_10AM) is None


def test_clock():
    assert clock(datetime(2026, 9, 12, 19, 44)) == "7:44pm"
    assert clock(datetime(2026, 9, 12, 23, 0)) == "11pm"
    assert clock(datetime(2026, 9, 12, 0, 5)) == "12:05am"


def test_sun_state():
    model = ConditionModel.__new__(ConditionModel)  # sun_state needs no data files
    night = model.sun_state(SAT_11PM.replace(tzinfo=SF_TZ))
    assert night["dark"] and night["dark_since"].hour == 19
    assert night["darkness"] == 1 and night["altitude"] < -12
    assert model.sun_state(MON_10AM.replace(tzinfo=SF_TZ))["darkness"] == 0
    after_midnight = model.sun_state(datetime(2026, 9, 13, 2, 0, tzinfo=SF_TZ))
    assert after_midnight["dark"] and after_midnight["dark_since"].day == 12
    assert model.sun_state(MON_10AM.replace(tzinfo=SF_TZ))["phase"] == "day"


def test_perpendicular_sign_and_unclamped():
    line = np.array([[0.0, 0.0], [0.0, 10.0]])  # walking north
    points = np.array([[5.0, 5.0], [-3.0, 20.0]])  # 5m east (right), 3m west past the line's end
    assert np.allclose(_perpendicular(points, line), [-5.0, 3.0])  # left positive


def test_crop_equirect_centres_heading():
    # Pano with a red stripe at the centre column: yaw 0 puts it mid-frame, yaw 180 hides it.
    pano = np.zeros((512, 1024, 3), dtype=np.uint8)
    pano[:, 508:516] = (255, 0, 0)
    img = Image.fromarray(pano)
    front = np.asarray(crop_equirect(img, 0))
    back = np.asarray(crop_equirect(img, 180))
    assert front.shape == (OUT_H, OUT_W, 3)
    assert front[OUT_H // 2, OUT_W // 2, 0] > 200
    assert back[:, :, 0].max() < 50


def test_fit_16_9():
    assert fit_16_9(Image.new("RGB", (1000, 1000))).size == (OUT_W, OUT_H)
    assert fit_16_9(Image.new("RGB", (4000, 1000))).size == (OUT_W, OUT_H)
