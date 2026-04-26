import { useState, useEffect } from "react";
import axios from "axios";

export function useWaitTime(station) {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!station) return;

    setLoading(true);
    axios.post("/chargers/predict-wait", {
      power_kw: station.power_kw || 22,
      num_ports: station.quantity || 2,
      current_occupancy: 0,  // real-time occupancy would come from IoT in future
    })
      .then(res => setPrediction(res.data))
      .catch(() => setPrediction(null))
      .finally(() => setLoading(false));
  }, [station]);

  return { prediction, loading };
}