export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export const globalErrorHandler = (err, req, res, next) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Invalid input data provided';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Authentication required';
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate field value entered';
  }

  const errorResponse = {
    success: false,
    error: {
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { 
        stack: err.stack,
        details: err 
      })
    }
  };

  res.status(statusCode).json(errorResponse);
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.originalUrl} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString()
    }
  });
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
