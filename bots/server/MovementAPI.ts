/**
 * MovementAPI - Public endpoints for movement analysis (dev only)
 * These endpoints bypass authentication and are only available in development
 */

import express, { type Request, type Response } from 'express';
import { movementLogger } from '../utils/MovementLogger';

export function setupMovementRoutes(app: express.Application): void {
    // Only enable in development
    const envValue = process.env.ENABLE_MOVEMENT_LOGGING;
    const nodeEnv = process.env.NODE_ENV;
    const isDevMode = envValue === 'true' || nodeEnv === 'development';
    
    console.log(`[MovementAPI] setupMovementRoutes called - ENABLE_MOVEMENT_LOGGING="${envValue}", NODE_ENV="${nodeEnv}", isDevMode=${isDevMode}`);
    
    if (!isDevMode) {
        // In production, return 404
        app.get('/api/movement/*', (req: Request, res: Response) => {
            res.status(404).json({ error: 'Movement analysis endpoints are only available in development mode' });
        });
        return;
    }
    
    console.log('[MovementAPI] Setting up movement analysis endpoints (PUBLIC, no auth)');
    
    // Get movement logs
    app.get('/api/movement/logs', (req: Request, res: Response) => {
        try {
            const botId = req.query.botId as string | undefined;
            const count = parseInt(req.query.count as string || '100', 10);
            
            if (botId) {
                const events = movementLogger.getRecentEvents(botId, count);
                res.json({ botId, events, count: events.length });
            } else {
                const allEvents = movementLogger.getAllEvents();
                res.json({ 
                    events: allEvents.slice(-count), 
                    count: allEvents.length,
                    total: allEvents.length
                });
            }
        } catch (error: any) {
            console.error('[MovementAPI] Error getting movement logs:', error);
            res.status(500).json({ error: error.message, events: [], count: 0 });
        }
    });
    
    // Analyze movement for a specific bot
    app.get('/api/movement/analyze/:botId', (req: Request, res: Response) => {
        try {
            const { botId } = req.params;
            const timeWindow = parseInt(req.query.timeWindow as string || '10000', 10);
            
            const analysis = movementLogger.analyzeMovement(botId, timeWindow);
            res.json({ botId, timeWindow, ...analysis });
        } catch (error: any) {
            console.error('[MovementAPI] Error analyzing movement:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    // Get movement summary
    app.get('/api/movement/summary', (req: Request, res: Response) => {
        try {
            const summary = movementLogger.getSummary();
            res.json(summary);
        } catch (error: any) {
            console.error('[MovementAPI] Error getting movement summary:', error);
            res.status(500).json({ error: error.message });
        }
    });
}

