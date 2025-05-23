import express, { Request, Response } from "express";
import axios from "axios";
import cors from "cors";
import { baseUrl } from "./config";
import { bfs, login } from "./helper";

const app = express();

app.use(express.json());
app.use(cors({
    origin: ["http://localhost:3000", "https://demo-graph-refactored.contentstackapps.com"],
    credentials: true
}));

app.get("/api/v3/items/bfs/content_types/:type/entries/:uid", async (req: Request, res: Response): Promise<any> => {
    const { locale, version } = req.query;
    const { type, uid } = req.params;
    const stackAPI = req.headers.api_key;
    const queue: any = [];
    const visited: any = new Set();

    if(!type || !uid || !stackAPI) {
        return res.status(400).json({
            message: "Missing essentials input data"
        })
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Transfer-Encoding", "chunked");
    res.flushHeaders();

    const headers = {
        api_key: stackAPI as string,
        authtoken: await login(),
        "Content-Type": "application/json",
    };

    const parent = {
        uid,
        locale,
        version,
        type
    };

    try {
        // send variants from here
        const localesResponse = await axios.get(`https://${baseUrl}/v3/locales`, { headers });
        let locales: any = await localesResponse.data;
        
        queue.push({ ref: parent, level: 0 });
        visited.add(parent.uid);

        await bfs(queue, visited, res, headers, locales.locales);
    }
    catch (error) {
        console.log("Error in route handler:", error);
    
        if (!res.headersSent) {
            return res.status(500).json({
                message: "Server error"
            });
        } else {
            try {
                res.status(500).write(JSON.stringify({ error: "Server error during streaming", _is_last_chunk: true }) + "\n");
                res.end();
            } catch (e) {
                console.error("Failed to write error to response stream:", e);
            }
        }
    }
});

export default app;