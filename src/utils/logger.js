const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  defaultMeta: { service: 'intellisense' },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    
    // Rotating file transport for all logs
    new DailyRotateFile({
      filename: path.join(logsDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    }),
    
    // Error log file
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error'
    }),
    
    // Performance log file
    new DailyRotateFile({
      filename: path.join(logsDir, 'performance-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '7d',
      level: 'info'
    })
  ]
});

// Add performance monitoring
logger.performance = (operation, duration, metadata = {}) => {
  logger.info('Performance', {
    operation,
    duration: `${duration}ms`,
    ...metadata
  });
};

// Add database operation logging
logger.db = (operation, duration, query = null, metadata = {}) => {
  logger.info('Database', {
    operation,
    duration: `${duration}ms`,
    query: query ? query.substring(0, 100) + '...' : null,
    ...metadata
  });
};

// Add scraping operation logging
logger.scraping = (source, status, itemsFound = 0, error = null, metadata = {}) => {
  logger.info('Scraping', {
    source,
    status,
    itemsFound,
    error: error?.message || null,
    ...metadata
  });
};

// Add AI operation logging
logger.ai = (operation, duration, tokens = null, metadata = {}) => {
  logger.info('AI', {
    operation,
    duration: `${duration}ms`,
    tokens,
    ...metadata
  });
};

// Add email operation logging
logger.email = (type, status, recipient = null, error = null, metadata = {}) => {
  logger.info('Email', {
    type,
    status,
    recipient,
    error: error?.message || null,
    ...metadata
  });
};

// Add scheduler operation logging
logger.scheduler = (job, status, duration = null, error = null, metadata = {}) => {
  logger.info('Scheduler', {
    job,
    status,
    duration: duration ? `${duration}ms` : null,
    error: error?.message || null,
    ...metadata
  });
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down logger...');
  logger.end();
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down logger...');
  logger.end();
});

module.exports = logger; 