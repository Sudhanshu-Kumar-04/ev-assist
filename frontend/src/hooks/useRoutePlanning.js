import { useState, useCallback, useEffect } from "react";
import routeService from "../services/routeService";

/**
 * Custom hook for managing route planning and saved routes
 * @returns {Object} Route management state and methods
 */
export const useRoutePlanning = () => {
    const [routes, setRoutes] = useState([]);
    const [currentRoute, setCurrentRoute] = useState(null);
    const [etaOptions, setEtaOptions] = useState([]);
    const [tripLegs, setTripLegs] = useState([]);
    const [selectedVehicleType, setSelectedVehicleType] = useState("car");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [routeAlternatives, setRouteAlternatives] = useState([]);

    /**
     * Fetch ETA for all vehicle types
     */
    const fetchEtaOptions = useCallback(async (origin, destination) => {
        setLoading(true);
        setError(null);
        try {
            const data = await routeService.getEtaByMode(origin, destination);
            setEtaOptions(data.etaOptions);
            return data;
        } catch (err) {
            setError(err.message);
            console.error("Error fetching ETA options:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Fetch trip details for selected vehicle type
     */
    const fetchTripDetails = useCallback(async (origin, destination, vehicleType) => {
        setLoading(true);
        setError(null);
        try {
            const data = await routeService.getTripDetails(origin, destination, vehicleType);
            setCurrentRoute(data);
            setSelectedVehicleType(vehicleType);
            return data;
        } catch (err) {
            setError(err.message);
            console.error("Error fetching trip details:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Fetch route alternatives
     */
    const fetchRouteAlternatives = useCallback(async (origin, destination) => {
        setLoading(true);
        setError(null);
        try {
            const data = await routeService.getRouteAlternatives(origin, destination);
            setRouteAlternatives(data.alternatives);
            return data;
        } catch (err) {
            setError(err.message);
            console.error("Error fetching route alternatives:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Calculate trip legs for the current route
     */
    const calculateLegs = useCallback(async (points, chargerStops, evProfile) => {
        setLoading(true);
        setError(null);
        try {
            const data = await routeService.calculateTripLegs(points, chargerStops, evProfile);
            setTripLegs(data.legs);
            return data;
        } catch (err) {
            setError(err.message);
            console.error("Error calculating trip legs:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Load all saved routes for the user
     */
    const loadSavedRoutes = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await routeService.getSavedRoutes();
            setRoutes(routeService.filterRoutes(data.routes, "date"));
            return data.routes;
        } catch (err) {
            setError(err.message);
            console.error("Error loading saved routes:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Save current route
     */
    const saveCurrentRoute = useCallback(async (routeName, chargers = []) => {
        if (!currentRoute) {
            setError("No current route to save");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const routeData = {
                routeName,
                fromLocation: currentRoute.from || "Start",
                toLocation: currentRoute.to || "End",
                fromLat: currentRoute.fromLat,
                fromLng: currentRoute.fromLng,
                toLat: currentRoute.toLat,
                toLng: currentRoute.toLng,
                distance: currentRoute.distanceKm,
                duration: currentRoute.estimatedTimeMinutes,
                vehicleType: selectedVehicleType,
                chargers,
            };

            const savedRoute = await routeService.saveRoute(routeData);
            setRoutes((prev) => [savedRoute.route, ...prev]);
            return savedRoute;
        } catch (err) {
            setError(err.message);
            console.error("Error saving route:", err);
        } finally {
            setLoading(false);
        }
    }, [currentRoute, selectedVehicleType]);

    /**
     * Delete a saved route
     */
    const deleteRouteById = useCallback(async (routeId) => {
        setLoading(true);
        setError(null);
        try {
            await routeService.deleteRoute(routeId);
            setRoutes((prev) => prev.filter((r) => r.id !== routeId));
            return true;
        } catch (err) {
            setError(err.message);
            console.error("Error deleting route:", err);
            return false;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Add a stop to a saved route
     */
    const addStopToRoute = useCallback(async (routeId, stopData) => {
        setLoading(true);
        setError(null);
        try {
            const result = await routeService.addRouteStop(routeId, stopData);
            setRoutes((prev) =>
                prev.map((r) => (r.id === routeId ? { ...r, charger_stops: result.stops } : r))
            );
            return result;
        } catch (err) {
            setError(err.message);
            console.error("Error adding stop:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Remove a stop from a saved route
     */
    const removeStopFromRoute = useCallback(async (routeId, stopIndex) => {
        setLoading(true);
        setError(null);
        try {
            const result = await routeService.removeRouteStop(routeId, stopIndex);
            setRoutes((prev) =>
                prev.map((r) => (r.id === routeId ? { ...r, charger_stops: result.stops } : r))
            );
            return result;
        } catch (err) {
            setError(err.message);
            console.error("Error removing stop:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Clear current route and errors
     */
    const clearRoute = useCallback(() => {
        setCurrentRoute(null);
        setRouteAlternatives([]);
        setTripLegs([]);
        setError(null);
    }, []);

    return {
        // State
        routes,
        currentRoute,
        etaOptions,
        tripLegs,
        selectedVehicleType,
        loading,
        error,
        routeAlternatives,

        // Methods
        fetchEtaOptions,
        fetchTripDetails,
        fetchRouteAlternatives,
        calculateLegs,
        loadSavedRoutes,
        saveCurrentRoute,
        deleteRouteById,
        addStopToRoute,
        removeStopFromRoute,
        clearRoute,
    };
};

export default useRoutePlanning;
