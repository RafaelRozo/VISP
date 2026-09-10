"""The address picker queries Mapbox with the user's text and a country filter."""

from unittest.mock import AsyncMock, patch

import pytest

from src.api.routes.geolocation import AddressSearchRequest, address_search_endpoint
from src.integrations.maps import geocoder


@pytest.fixture(autouse=True)
def clear_cache():
    geocoder.clear_geocoding_cache()
    yield
    geocoder.clear_geocoding_cache()


@pytest.mark.parametrize("query", ["2059 deer run", "2059 deer run avenue", "100 queen street"])
async def test_autocomplete_preserves_user_input_and_canadian_filter(query):
    features = [
        {"id": "address.one", "place_name": "First match, Ontario, Canada",
         "center": [-79.8165, 43.374616], "relevance": 1},
        {"id": "address.two", "place_name": "Second match, Ontario, Canada",
         "center": [-79.65, 43.55], "relevance": 0.95},
    ]
    with patch.object(geocoder, "geocode_address", AsyncMock(return_value={"all_results": features})) as search:
        response = await address_search_endpoint(AddressSearchRequest(query=query, country="CA"))
    search.assert_awaited_once_with(query, country="CA", proximity=None, limit=5)
    assert len(response["results"]) == 2
    assert response["results"][0]["lat"] == 43.374616
    assert response["results"][0]["lng"] == -79.8165
    assert response["results"][1]["place_id"] == "address.two"


async def test_no_matches_never_substitutes_an_address():
    with patch.object(geocoder, "geocode_address", AsyncMock(return_value={"all_results": []})) as search:
        response = await address_search_endpoint(AddressSearchRequest(query="unknown street", country="CA"))
    assert response == {"results": []}
    search.assert_awaited_once_with("unknown street", country="CA", proximity=None, limit=5)


async def test_short_query_does_not_call_mapbox():
    with patch.object(geocoder, "geocode_address", AsyncMock()) as search:
        assert await geocoder.search_address_suggestions("20", country="CA") == []
    search.assert_not_awaited()


async def test_geocode_does_not_append_country_codes_to_street_query():
    result = {"lat": 43.37, "lng": -79.81, "formatted_address": "Canadian address",
              "place_id": "address.test", "location_type": "ROOFTOP"}
    with patch.object(geocoder, "geocode_address", AsyncMock(return_value=result)) as search:
        await geocoder.geocode_service_address("2059 deer run avenue", "", "", "", "CA")
    search.assert_awaited_once_with("2059 deer run avenue", country="CA")
