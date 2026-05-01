import axios from "axios";

const API = axios.create({
    baseURL: process.env.REACT_APP_API_URL || "/chargers",
});

/**
 * Get trip details for a specific vehicle type
 * @param {string} origin - "lng,lat" format
 * @param {string} destination - "lng,lat" format
 * @param {string} vehicleType - 'car', 'two-wheeler', 'bike', 'electric_bike', 'foot'
 * @returns {Promise} Trip details with ETA and distance
 */
export const getTripDetails = async (origin, destination, vehicleType = "car") => {
    try {
        const response = await API.post("/route/trip-details", {
            origin,
            destination,
            vehicleType,
        });
        return response.data;
    } catch (error) {
        console.error("Error getting trip details:", error);
        throw error;
    }
};

/**
 * Get multiple route alternatives (fastest, balanced, scenic)
 * @param {string} origin - "lng,lat" format
 * @param {string} destination - "lng,lat" format
 * @returns {Promise} Array of route alternatives
 */
export const getRouteAlternatives = async (origin, destination) => {
    try {
        const response = await API.post("/route/alternatives", {
            origin,
            destination,
        });
        return response.data;
    } catch (error) {
        console.error("Error getting route alternatives:", error);
        throw error;
    }
};

/**
 * Calculate trip legs with charger stops
 * @param {Array} points - Route points
 * @param {Array} chargerStops - Charger stops along the route
 * @param {Object} evProfile - EV profile configuration
 * @returns {Promise} Trip legs breakdown
 */
export const calculateTripLegs = async (points, chargerStops = [], evProfile = {}) => {
    try {
        const response = await API.post("/route/trip-legs", {
            points,
            chargerStops,
            evProfile,
        });
        return response.data;
    } catch (error) {
        console.error("Error calculating trip legs:", error);
        throw error;
    }
};

/**
 * Get ETA comparison for all vehicle types
 * @param {string} origin - "lng,lat" format
 * @param {string} destination - "lng,lat" format
 * @returns {Promise} ETA options for all vehicle types
 */
export const getEtaByMode = async (origin, destination) => {
    try {
        const response = await API.post("/route/eta-by-mode", {
            origin,
            destination,
        });
        return response.data;
    } catch (error) {
        console.error("Error getting ETA by mode:", error);
        throw error;
    }
};

/**
 * Save a route for the user
 * @param {Object} routeData - Route information to save
 * @returns {Promise} Saved route details
 */
export const saveRoute = async (routeData) => {
    try {
        const response = await API.post("/routes/save", routeData);
        return response.data;
    } catch (error) {
        console.error("Error saving route:", error);
        throw error;
    }
};

/**
 * Get all saved routes for the authenticated user
 * @returns {Promise} Array of saved routes
 */
export const getSavedRoutes = async () => {
    try {
        const response = await API.get("/routes/saved");
        return response.data;
    } catch (error) {
        console.error("Error fetching saved routes:", error);
        throw error;
    }
};

/**
 * Delete a saved route
 * @param {number} routeId - ID of the route to delete
 * @returns {Promise} Deletion confirmation
 */
export const deleteRoute = async (routeId) => {
    try {
        const response = await API.delete(`/routes/${routeId}`);
        return response.data;
    } catch (error) {
        console.error("Error deleting route:", error);
        throw error;
    }
};

/**
 * Add a stop to an existing saved route
 * @param {number} routeId - ID of the route
 * @param {Object} stopData - Stop information (name, lat, lng, index)
 * @returns {Promise} Updated route with new stop
 */
export const addRouteStop = async (routeId, stopData) => {
    try {
        const response = await API.post(`/routes/${routeId}/add-stop`, {
            stopName: stopData.name,
            stopLat: stopData.latitude,
            stopLng: stopData.longitude,
            stopIndex: stopData.index,
        });
        return response.data;
    } catch (error) {
        console.error("Error adding stop to route:", error);
        throw error;
    }
};

/**
 * Remove a stop from a saved route
 * @param {number} routeId - ID of the route
 * @param {number} stopIndex - Index of the stop to remove
 * @returns {Promise} Updated route without the stop
 */
export const removeRouteStop = async (routeId, stopIndex) => {
    try {
        const response = await API.post(`/routes/${routeId}/remove-stop`, {
            stopIndex,
        });
        return response.data;
    } catch (error) {
        console.error("Error removing stop from route:", error);
        throw error;
    }
};

/**
 * Format route display data
 * @param {Object} routeData - Raw route data from API
 * @returns {Object} Formatted route data for UI
 */
export const formatRouteData = (routeData) => {
    return {
        ...routeData,
        displayDistance: `${routeData.distanceKm} km`,
        displayTime: routeData.estimatedTimeFormatted,
        displayArrival: routeData.arrivalTimeFormatted,
    };
};

/**
 * Filter and sort routes
 * @param {Array} routes - Array of routes to filter
 * @param {string} sortBy - Sort criteria: 'distance', 'duration', 'date'
 * @returns {Array} Filtered and sorted routes
 */
export const filterRoutes = (routes, sortBy = "date") => {
    let sorted = [...routes];

    switch (sortBy) {
        case "distance":
            sorted.sort((a, b) => a.distance_km - b.distance_km);
            break;
        case "duration":
            sorted.sort((a, b) => a.duration_minutes - b.duration_minutes);
            break;
        case "date":
        default:
            sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return sorted;
};

export default {
    getTripDetails,
    getRouteAlternatives,
    calculateTripLegs,
    getEtaByMode,
    saveRoute,
    getSavedRoutes,
    deleteRoute,
    addRouteStop,
    removeRouteStop,
    formatRouteData,
    filterRoutes,
};
