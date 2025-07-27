import NodeCache from "node-cache";
import { config } from "../config/index.js";

const cache = new NodeCache({
  stdTTL: config.cache.defaultTTL,
  maxKeys: config.cache.maxKeys,
  useClones: false,
  checkperiod: 120,
  deleteOnExpire: true
});

export const cacheMiddleware = (duration = config.cache.defaultTTL) => {
  return (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const userId = req.authenticatedUser?.uid || 'anonymous';
    const queryString = Object.keys(req.query).length > 0 
      ? `?${new URLSearchParams(req.query).toString()}` 
      : '';
    
    const cacheKey = `${req.method}:${req.baseUrl}${req.path}${queryString}:${userId}`;
    
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
        cached: true,
        timestamp: new Date().toISOString()
      });
    }

    res.originalJson = res.json;
    
    res.json = function(responseData) {
      if (responseData.success !== false && res.statusCode < 400) {
        const dataToCache = responseData.data || responseData;
        cache.set(cacheKey, dataToCache, duration);
        responseData.cached = false;
      }
      
      return res.originalJson(responseData);
    };
    
    next();
  };
};

export default cache;
