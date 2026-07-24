from project_address_agent.geo import point_in_geometry, point_in_polygon


def test_polygon_contains_point_and_excludes_hole() -> None:
    polygon = [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
    ]
    assert point_in_polygon(2, 2, polygon)
    assert not point_in_polygon(5, 5, polygon)
    assert not point_in_polygon(11, 5, polygon)


def test_polygon_boundary_is_inside() -> None:
    polygon = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
    assert point_in_polygon(0, 1, polygon)


def test_multipolygon_checks_every_polygon() -> None:
    geometry = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
        ],
    }
    assert point_in_geometry(5.5, 5.5, geometry)
    assert not point_in_geometry(3, 3, geometry)
