
import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch
import uuid
from src.integrations.maps import GeocodingResult, DistanceResult
from src.services.auth_service import create_access_token

CUSTOMER_USER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

@pytest.fixture
def mock_geo_services():
    with patch("src.api.routes.geolocation.geocode_service_address", new_callable=AsyncMock) as mock_geo, \
         patch("src.api.routes.geolocation.reverse_geocode", new_callable=AsyncMock) as mock_rev, \
         patch("src.api.routes.geolocation.calculate_driving_distance", new_callable=AsyncMock) as mock_dist, \
         patch("src.api.routes.geolocation.get_directions", new_callable=AsyncMock) as mock_dir:
        
        # Setup default returns
        mock_geo.return_value = GeocodingResult(
            lat=43.6532,
            lng=-79.3832,
            formatted_address="123 Test St, Toronto, ON",
            place_id="place_123",
            confidence="high"
        )
        
        mock_rev.return_value = {
            "formatted_address": "123 Test St, Toronto, ON",
            "place_id": "place_123",
            "address_components": []
        }
        
        mock_dist.return_value = DistanceResult(
            distance_km=5.0,
            duration_minutes=15.0,
            route_polyline="encoded_polyline",
            is_fallback=False
        )
        
        mock_dir.return_value = {
            "routes": [{"distance": 5000, "duration": 900, "geometry": "sometoken"}]
        }
        
        yield {
            "geocode": mock_geo,
            "reverse": mock_rev,
            "dist": mock_dist,
            "dir": mock_dir
        }

@pytest.fixture
def customer_token_headers():
    token, _ = create_access_token(CUSTOMER_USER_ID)
    return {"Authorization": f"Bearer {token}"}

@pytest.mark.asyncio
async def test_geocode_endpoint(client: AsyncClient, customer_token_headers: dict, mock_geo_services):
    payload = {
        "address": "123 Test St",
        "city": "Toronto",
        "province": "ON"
    }
    response = await client.post("/api/v1/geo/geocode", json=payload, headers=customer_token_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["lat"] == 43.6532
    assert data["lng"] == -79.3832
    assert mock_geo_services["geocode"].called

@pytest.mark.asyncio
async def test_reverse_geocode_endpoint(client: AsyncClient, customer_token_headers: dict, mock_geo_services):
    payload = {
        "lat": 43.6532,
        "lng": -79.3832
    }
    response = await client.post("/api/v1/geo/reverse", json=payload, headers=customer_token_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["formatted_address"] == "123 Test St, Toronto, ON"
    assert mock_geo_services["reverse"].called

@pytest.mark.asyncio
async def test_distance_endpoint(client: AsyncClient, customer_token_headers: dict, mock_geo_services):
    payload = {
        "origin_lat": 43.6532,
        "origin_lng": -79.3832,
        "dest_lat": 43.7000,
        "dest_lng": -79.4000
    }
    response = await client.post("/api/v1/geo/distance", json=payload, headers=customer_token_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["distance_km"] == 5.0
    assert data["duration_minutes"] == 15.0
    assert mock_geo_services["dist"].called

@pytest.mark.asyncio
async def test_directions_endpoint(client: AsyncClient, customer_token_headers: dict, mock_geo_services):
    payload = {
        "origin_lat": 43.6532,
        "origin_lng": -79.3832,
        "dest_lat": 43.7000,
        "dest_lng": -79.4000
    }
    response = await client.post("/api/v1/geo/directions", json=payload, headers=customer_token_headers)
    assert response.status_code == 200
    data = response.json()
    assert "routes" in data
    assert mock_geo_services["dir"].called
