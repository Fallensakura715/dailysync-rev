import fs from 'fs';
import path from 'path';

import { configureGarminWreqClient, wreqFetchResponse } from './utils/wreq_client';

const { GarminConnect } = require('@gooin/garmin-connect');

const chromeIdentityHeaders = require('wreq-js').getEmulationHeaders('chrome_149', 'windows');

const loadRootDotEnv = (): void => {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const entry = line.trim();
        if (!entry || entry.startsWith('#')) {
            continue;
        }

        const separator = entry.indexOf('=');
        if (separator < 0) {
            continue;
        }

        const name = entry.slice(0, separator).trim();
        let value = entry.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (process.env[name] === undefined) {
            process.env[name] = value;
        }
    }
};

loadRootDotEnv();

const {
    GARMIN_GLOBAL_PASSWORD_DEFAULT,
    GARMIN_GLOBAL_USERNAME_DEFAULT,
    GARMIN_PASSWORD_DEFAULT,
    GARMIN_USERNAME_DEFAULT,
} = require('./constant');

type StageName = 'fetchOauthConsumer' | 'getLoginTicket' | 'getOauth1Token' | 'exchange';

const getHttpStatus = (error: any): number | undefined => {
    if (error?.response?.status) {
        return error.response.status;
    }

    const match = /ERROR:\s*\((\d{3})\)/.exec(String(error?.message ?? error));
    return match ? Number(match[1]) : undefined;
};

const traceStage = (owner: any, name: StageName, label: string): void => {
    const original = owner[name].bind(owner);
    owner[name] = async (...args: any[]) => {
        console.log(`[${label}] start`);
        try {
            const result = await original(...args);
            console.log(`[${label}] passed`);
            return result;
        } catch (error) {
            const status = getHttpStatus(error);
            console.error(`[${label}] failed${status ? ` (HTTP ${status})` : ''}`);
            throw error;
        }
    };
};

const summarizeResponse = (body: string): string[] => {
    const markers: string[] = [];
    if (/ticket=/i.test(body)) markers.push('ticket-present');
    if (/cf-chl-widget|cf_chl_opt|id=["']challenge-form["']/i.test(body)) markers.push('challenge-form');
    if (/enter (your )?(verification|security|mfa) code|name=["'](?:otp|mfa|verificationCode)["']/i.test(body)) {
        markers.push('verification-prompt');
    }
    if (/rate.limit|too many requests/i.test(body)) markers.push('rate-limit-marker');
    if (/account.?locked/i.test(body)) markers.push('account-lock-marker');
    const title = /<title[^>]*>(.*?)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, ' ').slice(0, 100);
    if (title) {
        if (/^(just a moment|attention required|access denied)/i.test(title)) markers.push('challenge-page-title');
        markers.push(`title=${title}`);
    }
    return markers;
};

const traceWreqResponses = (client: any): void => {
    const axiosClient = client.client.client;
    const adapter = axiosClient.defaults.adapter;
    axiosClient.defaults.adapter = async (config: any) => {
        const requestUrl = new URL(config.url, config.baseURL);
        try {
            const response = await adapter(config);
            const markers = typeof response.data === 'string' ? summarizeResponse(response.data) : [];
            console.log(`[wreq] ${config.method.toUpperCase()} ${requestUrl.host}${requestUrl.pathname} -> HTTP ${response.status}${markers.length ? `; ${markers.join(', ')}` : ''}`);
            return response;
        } catch (error) {
            const response = (error as any)?.response;
            const status = response?.status ?? getHttpStatus(error);
            const markers = typeof response?.data === 'string' ? summarizeResponse(response.data) : [];
            console.log(`[wreq] ${config.method.toUpperCase()} ${requestUrl.host}${requestUrl.pathname} -> ${status ? `HTTP ${status}` : 'transport error'}${markers.length ? `; ${markers.join(', ')}` : ''}`);
            throw error;
        }
    };
};

const reportPublicIp = async (name: string, request: (url: string) => Promise<any>): Promise<void> => {
    const probes = [
        { url: 'https://api.ipify.org?format=json', parse: (body: string) => JSON.parse(body).ip },
        { url: 'https://icanhazip.com', parse: (body: string) => body.trim() },
    ];

    for (const probe of probes) {
        try {
            const response = await request(probe.url);
            const body = await response.text();
            if (!response.ok) {
                console.log(`${name} IP probe ${new URL(probe.url).host}: HTTP ${response.status}; body=${body.slice(0, 160).replace(/\s+/g, ' ')}`);
                continue;
            }

            const ip = probe.parse(body);
            console.log(`${name} outbound IP (${new URL(probe.url).host}): ${ip}`);
            return;
        } catch (error) {
            console.log(`${name} IP probe ${new URL(probe.url).host}: unavailable (${error instanceof Error ? error.message : String(error)})`);
        }
    }
};

const main = async (): Promise<void> => {
    const region = String(process.env.GARMIN_TEST_REGION ?? 'GLOBAL').trim().toUpperCase();
    if (region !== 'CN' && region !== 'GLOBAL') {
        throw new Error('GARMIN_TEST_REGION must be CN or GLOBAL');
    }

    const username = region === 'CN'
        ? process.env.GARMIN_USERNAME ?? GARMIN_USERNAME_DEFAULT
        : process.env.GARMIN_GLOBAL_USERNAME ?? GARMIN_GLOBAL_USERNAME_DEFAULT;
    const password = region === 'CN'
        ? process.env.GARMIN_PASSWORD ?? GARMIN_PASSWORD_DEFAULT
        : process.env.GARMIN_GLOBAL_PASSWORD ?? GARMIN_GLOBAL_PASSWORD_DEFAULT;

    if (!username || !password) {
        throw new Error(`Set the ${region === 'CN' ? 'GARMIN_USERNAME/GARMIN_PASSWORD' : 'GARMIN_GLOBAL_USERNAME/GARMIN_GLOBAL_PASSWORD'} values in .env`);
    }

    console.log(`Testing Garmin ${region} login with wreq-js Chrome 149`);
    await reportPublicIp('Node fetch', url => fetch(url));
    await reportPublicIp('wreq-js', url => wreqFetchResponse(url, { headers: chromeIdentityHeaders }));

    const client = region === 'CN'
        ? new GarminConnect({ username, password }, 'garmin.cn')
        : new GarminConnect({ username, password });

    configureGarminWreqClient(client);
    traceWreqResponses(client);
    traceStage(client.client, 'fetchOauthConsumer', 'OAuth consumer');
    traceStage(client.client, 'getLoginTicket', 'Garmin sign-in / ticket');
    traceStage(client.client, 'getOauth1Token', 'OAuth1 preauthorization');
    traceStage(client.client, 'exchange', 'OAuth2 exchange');

    try {
        await client.login();
        await client.getUserProfile();
        console.log(`Garmin ${region} login succeeded; user profile request passed.`);
        console.log('No session token was written to disk.');
    } catch (error) {
        console.error(`Garmin ${region} login failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
};

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
