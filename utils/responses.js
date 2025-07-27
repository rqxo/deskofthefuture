export const sendSuccessResponse = (res, data = null, message = 'Success', meta = {}) => {
  const response = {
    success: true,
    message,
    timestamp: new Date().toISOString(),
    ...meta
  };
  
  if (data !== null) {
    response.data = data;
  }
  
  return res.json(response);
};

export const sendErrorResponse = (res, message = 'Internal server error', statusCode = 500, code = null) => {
  const response = {
    success: false,
    error: {
      message,
      code: code || `HTTP_${statusCode}`,
      timestamp: new Date().toISOString()
    }
  };
  
  return res.status(statusCode).json(response);
};

export const sendPaginatedResponse = (res, data, pagination, message = 'Data retrieved successfully') => {
  return res.json({
    success: true,
    message,
    data,
    pagination,
    timestamp: new Date().toISOString()
  });
};
