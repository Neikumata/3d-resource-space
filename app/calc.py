def calculate_position(centers, weights):
    """加权平均计算资源球坐标。

    Args:
        centers: [(x, y, z), ...] 中心点坐标列表
        weights: [float, ...] 对应权重列表

    Returns:
        (x, y, z) 计算得出的坐标

    Raises:
        ValueError: centers 和 weights 长度不匹配或全零权重
    """
    if len(centers) != len(weights):
        raise ValueError("centers and weights must have same length")
    if not centers:
        raise ValueError("at least one center is required")
    total = sum(weights)
    if total == 0:
        raise ValueError("total weight must not be zero")
    x = sum(w * c[0] for w, c in zip(weights, centers)) / total
    y = sum(w * c[1] for w, c in zip(weights, centers)) / total
    z = sum(w * c[2] for w, c in zip(weights, centers)) / total
    return (x, y, z)
