"""偏航对中判定：按功率档合格带闭区间分带判定。

每个功率档（微风档、大功率档…）各自维护一条闭区间 [下限, 上限]，
偏航误差落在闭区间内（含端点）判「合格」，否则判「偏航超差」。
"""

DEFAULT_LOWER_DEG = -1.5
DEFAULT_UPPER_DEG = 1.5


def judge(
    yaw_err_deg: float,
    lower_deg: float = DEFAULT_LOWER_DEG,
    upper_deg: float = DEFAULT_UPPER_DEG,
) -> tuple[str, str]:
    band = f"[{lower_deg}°, {upper_deg}°]"
    if lower_deg <= yaw_err_deg <= upper_deg:
        return "合格", f"偏航误差 {yaw_err_deg}° 落在 {band} 闭区间内"
    return "偏航超差", f"偏航误差 {yaw_err_deg}° 超出 {band} 闭区间"
