
const fs = require('fs');
const path = require('path');

const legacyNode = {
    name: "GlaceYT",
    password: "glace",
    host: "de-01.strixnodes.com",
    port: 2010,
    secure: false
};

function normalizeNode(node, index) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;

    const endpoint = String(node.url || node.host || '').trim();
    if (!endpoint) return null;

    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(endpoint);
    const defaultSecure = node.secure === undefined
        ? /^https:\/\//i.test(endpoint) || /^wss:\/\//i.test(endpoint)
        : node.secure === true || String(node.secure).trim().toLowerCase() === 'true';
    let parsedUrl;

    try {
        parsedUrl = new URL(
            hasScheme
                ? endpoint
                : `${defaultSecure ? 'https' : 'http'}://${endpoint}`
        );
    } catch {
        return null;
    }

    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsedUrl.protocol)) {
        return null;
    }

    const secure = node.secure === undefined
        ? parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'wss:'
        : defaultSecure;
    const port = Number(node.port || parsedUrl.port || (secure ? 443 : 2333));
    const password = String(node.password ?? node.auth ?? '').trim();

    if (!parsedUrl.hostname || !Number.isInteger(port) || port < 1 || port > 65535 || !password) {
        return null;
    }

    return {
        name: String(node.name || `Lavalink-${index + 1}`),
        host: parsedUrl.hostname,
        port,
        password,
        secure
    };
}

function normalizeNodes(parsed) {
    if (!Array.isArray(parsed)) return [];

    const uniqueNodes = new Map();
    parsed.forEach((node, index) => {
        const normalized = normalizeNode(node, index);
        if (!normalized) {
            console.warn(`[Lavalink] Skipping invalid node configuration at index ${index}.`);
            return;
        }

        uniqueNodes.set(
            `${normalized.host.toLowerCase()}:${normalized.port}`,
            normalized
        );
    });

    return [...uniqueNodes.values()];
}

function loadNodes() {
    const configuredNodes = process.env.LAVALINK_NODES_JSON?.trim();
    if (configuredNodes) {
        try {
            const parsed = JSON.parse(configuredNodes);
            const normalized = normalizeNodes(parsed);
            if (normalized.length > 0) {
                return { nodes: normalized, source: 'LAVALINK_NODES_JSON' };
            }
            throw new Error('No valid node entries were found');
        } catch (error) {
            throw new Error(`Invalid LAVALINK_NODES_JSON: ${error.message}`);
        }
    }

    const configuredNodesFile = process.env.LAVALINK_NODES_FILE?.trim();
    const nodesFile = configuredNodesFile || path.join(__dirname, 'lavalink', 'nodes.json');

    try {
        const parsed = JSON.parse(fs.readFileSync(nodesFile, 'utf8'));
        const normalized = normalizeNodes(parsed);
        if (normalized.length > 0) {
            return {
                nodes: normalized,
                source: configuredNodesFile ? 'LAVALINK_NODES_FILE' : 'lavalink/nodes.json'
            };
        }
    } catch (error) {
        console.warn(`[Lavalink] Could not load ${nodesFile}: ${error.message}`);
    }

    return { nodes: [legacyNode], source: 'built-in legacy fallback' };
}

const { nodes, source: nodeSource } = loadNodes();

module.exports = {
    enabled: true,
    nodeSource,
    lavalink: {
        nodes,
        defaultSearchPlatform: process.env.LAVALINK_SEARCH_PLATFORM || "ytsearch",
        restVersion: "v4"
    }
};




