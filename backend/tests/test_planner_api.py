import os
import sys

# Ensure repository root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi.testclient import TestClient
from backend.main import app
from backend.deployment.planner import PlannerInput
from backend.deployment.run_planner import run

client = TestClient(app)


def test_run_planner_returns_dict_no_files():
    # Make sure output files do not exist
    for f in ["deployment.json", "deployment.png"]:
        if os.path.exists(f):
            os.remove(f)

    p = PlannerInput(28.6139, 77.2090, 1000, 1000, 300, 1000)
    result = run(p, (0, -500))

    assert isinstance(result, dict)
    assert "nodes" in result
    assert "links" in result
    assert "gateway" in result
    assert "wifi_coverage" in result
    assert "valid" in result

    # Check that no files were written
    assert not os.path.exists("deployment.json"), "deployment.json was created when not asked"
    assert not os.path.exists("deployment.png"), "deployment.png was created when not asked"


def test_run_planner_writes_files_when_asked():
    test_json = "test_custom_out.json"
    test_png = "test_custom_out.png"
    for f in [test_json, test_png]:
        if os.path.exists(f):
            os.remove(f)

    p = PlannerInput(28.6139, 77.2090, 1000, 1000, 300, 1000)
    result = run(p, (0, -500), out_json=test_json, out_png=test_png)

    assert isinstance(result, dict)
    assert os.path.exists(test_json), f"{test_json} was not created"
    assert os.path.exists(test_png), f"{test_png} was not created"

    # Clean up
    for f in [test_json, test_png]:
        if os.path.exists(f):
            os.remove(f)


def test_fastapi_plan_endpoint():
    payload = {
        "center_lat": 28.6139,
        "center_lon": 77.2090,
        "width_m": 1000,
        "height_m": 1000,
        "wifi_range_m": 300,
        "lora_range_m": 1000,
        "gateway_xy": [0, -500],
        "restricted_zones": [{"lat": 28.6139, "lon": 77.2090, "radius_m": 100}],
    }

    response = client.post("/plan", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()

    assert "assumptions" in data
    assert data["assumptions"]["wifi_range_m"] == 300
    assert data["assumptions"]["lora_range_m"] == 1000
    assert data["assumptions"]["area_m"] == [1000, 1000]
    assert len(data["assumptions"]["restricted_zones"]) == 1

    assert "nodes" in data
    assert len(data["nodes"]) > 0
    assert "gateway" in data
    assert data["gateway"]["id"] == "GATEWAY"
    assert "links" in data
    assert "deployment_order" in data
    assert "drone_targets" in data
    assert "wifi_coverage" in data
    assert "valid" in data
    assert data["valid"] is True


if __name__ == "__main__":
    print("Testing run_planner returns dict and no files by default...")
    test_run_planner_returns_dict_no_files()
    print("PASSED!")

    print("Testing run_planner writes files when asked...")
    test_run_planner_writes_files_when_asked()
    print("PASSED!")

    print("Testing FastAPI POST /plan endpoint...")
    test_fastapi_plan_endpoint()
    print("PASSED!")
    print("ALL TESTS PASSED SUCCESSFULLY!")
