from project_address_agent.models import classify_project


def test_classifies_missing_name_before_threshold() -> None:
    assert (
        classify_project(
            project_name=None,
            active_deals=0,
            project_id=None,
            lat=None,
            lng=None,
        )
        == "missing_name"
    )


def test_classifies_mangled_name() -> None:
    assert (
        classify_project(
            project_name="?讀伊頓",
            active_deals=20,
            project_id=1,
            lat=None,
            lng=None,
        )
        == "name_mangled"
    )


def test_classifies_below_threshold() -> None:
    assert (
        classify_project(
            project_name="測試建案",
            active_deals=2,
            project_id=None,
            lat=None,
            lng=None,
        )
        == "below_threshold"
    )


def test_classifies_missing_project_after_threshold() -> None:
    assert (
        classify_project(
            project_name="測試建案",
            active_deals=3,
            project_id=None,
            lat=None,
            lng=None,
        )
        == "project_missing"
    )


def test_classifies_project_without_coordinate() -> None:
    assert (
        classify_project(
            project_name="測試建案",
            active_deals=3,
            project_id=7,
            lat=None,
            lng=None,
        )
        == "project_no_coord"
    )


def test_classifies_resolved_project() -> None:
    assert (
        classify_project(
            project_name="測試建案",
            active_deals=3,
            project_id=7,
            lat=24.99,
            lng=121.31,
        )
        == "resolved"
    )


def test_resolved_mangled_name_is_not_an_address_repair_case() -> None:
    assert (
        classify_project(
            project_name="已定位建案?",
            active_deals=3,
            project_id=7,
            lat=24.99,
            lng=121.31,
        )
        == "resolved"
    )
