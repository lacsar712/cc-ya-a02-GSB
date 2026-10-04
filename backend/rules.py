"""偏航对中判定：按功率档闭区间判定，下限 <= 误差 <= 上限为合格。

上下限由调用方传入——worker 传入认领当时写入单据快照的那一档上下限，
绝不直接读取当前档位表，以免改档影响已认领单据。
"""


def judge(
    yaw_err_deg: float,
    lower_deg: float,
    upper_deg: float,
    gear_label: str | None = None,
) -> tuple[str, str]:
    band = f"（{gear_label}）" if gear_label else ""
    if lower_deg <= yaw_err_deg <= upper_deg:
        return (
            "合格",
            f"偏航误差 {yaw_err_deg}°{band}在闭区间 "
            f"[{lower_deg}°, {upper_deg}°] 内",
        )
    return (
        "偏航超差",
        f"偏航误差 {yaw_err_deg}°{band}超出闭区间 "
        f"[{lower_deg}°, {upper_deg}°]",
    )
