import qs from 'qs';

const { createSession, fetch: wreqFetch } = require('wreq-js');
const { PassThrough, Readable } = require('stream');

const WREQ_PROFILE = {
    browser: 'chrome_149',
    os: 'windows',
};
const OAUTH_CONSUMER_URL = 'https://thegarth.s3.amazonaws.com/oauth_consumer.json';

type AxiosLikeConfig = {
    url?: string;
    baseURL?: string;
    params?: Record<string, any>;
    paramsSerializer?: any;
    method?: string;
    headers?: any;
    data?: any;
    timeout?: number;
    signal?: AbortSignal;
    responseType?: string;
    validateStatus?: (status: number) => boolean;
    [key: string]: any;
};

const toUrl = (config: AxiosLikeConfig): string => {
    const url = new URL(config.url ?? '', config.baseURL);
    if (config.params) {
        const serializer = config.paramsSerializer;
        const serializedParams = typeof serializer === 'function'
            ? serializer(config.params)
            : serializer?.serialize?.(config.params) ?? qs.stringify(config.params, {
                arrayFormat: 'brackets',
                skipNulls: true,
            });

        if (serializedParams) {
            url.search = [url.search.slice(1), serializedParams].filter(Boolean).join('&');
        }
    }
    return url.toString();
};

const toHeaders = (input: any): Record<string, string> => {
    const values = typeof input?.toJSON === 'function' ? input.toJSON() : input;
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(values ?? {})) {
        if (value !== undefined && value !== null) {
            headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
        }
    }

    return headers;
};

const isFormDataStream = (value: any): boolean => {
    return Boolean(value && typeof value.getHeaders === 'function' && typeof value.pipe === 'function');
};

const getFormLength = (form: any): Promise<number | undefined> => new Promise(resolve => {
    if (typeof form.getLength !== 'function') {
        resolve(undefined);
        return;
    }

    form.getLength((error: Error | null, length: number) => resolve(error ? undefined : length));
});

const makeAxiosError = (message: string, config: AxiosLikeConfig, response: any): Error => {
    const error: any = new Error(message);
    error.config = config;
    error.request = response?.request;
    error.response = response;
    error.isAxiosError = true;
    return error;
};

export const createWreqAxiosAdapter = () => {
    let sessionPromise: Promise<any> | undefined;
    const getSession = () => {
        if (!sessionPromise) {
            sessionPromise = createSession(WREQ_PROFILE);
            process.once('beforeExit', () => {
                void sessionPromise?.then(session => session.close()).catch(() => {});
            });
        }
        return sessionPromise;
    };

    return async (config: AxiosLikeConfig): Promise<any> => {
        const url = toUrl(config);
        const method = (config.method ?? 'get').toUpperCase();
        const headers = toHeaders(config.headers);
        let body = config.data;

        if (isFormDataStream(body)) {
            for (const [name, value] of Object.entries(body.getHeaders())) {
                if (!Object.keys(headers).some(header => header.toLowerCase() === name.toLowerCase())) {
                    headers[name] = String(value);
                }
            }

            const contentLength = await getFormLength(body);
            if (contentLength !== undefined && !Object.keys(headers).some(header => header.toLowerCase() === 'content-length')) {
                headers['Content-Length'] = String(contentLength);
            }

            const stream = new PassThrough();
            body.pipe(stream);
            body = stream;
        }

        let response: any;
        try {
            const session = await getSession();
            response = await session.fetch(url, {
                ...WREQ_PROFILE,
                method,
                headers,
                body: body == null ? undefined : body,
                signal: config.signal,
                timeout: config.timeout && config.timeout > 0 ? config.timeout : undefined,
                redirect: config.maxRedirects === 0 ? 'manual' : 'follow',
            });
        } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause);
            const networkResponse = {
                status: 0,
                statusText: 'Network Error',
                data: detail,
                headers: {},
                config,
                request: url,
            };
            throw makeAxiosError(`Network Error: ${detail}`, config, networkResponse);
        }

        let data: any;
        if (config.responseType === 'arraybuffer') {
            data = Buffer.from(await response.arrayBuffer());
        } else if (config.responseType === 'stream') {
            data = response.body ? Readable.fromWeb(response.body) : null;
        } else if (config.responseType === 'blob') {
            data = await response.blob();
        } else if (config.responseType === 'json') {
            data = await response.json();
        } else {
            data = await response.text();
        }

        const axiosResponse = {
            data,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            config,
            request: url,
        };

        const validateStatus = config.validateStatus ?? ((status: number) => status >= 200 && status < 300);
        if (!validateStatus(response.status)) {
            throw makeAxiosError(`Request failed with status code ${response.status}`, config, axiosResponse);
        }

        return axiosResponse;
    };
};

export const configureGarminWreqClient = (garminClient: any): void => {
    garminClient.client.client.defaults.adapter = createWreqAxiosAdapter();
    garminClient.client.fetchOauthConsumer = async () => {
        const response = await wreqRequest(OAUTH_CONSUMER_URL);
        const consumer = await response.json();
        garminClient.client.OAUTH_CONSUMER = {
            key: consumer.consumer_key,
            secret: consumer.consumer_secret,
        };
    };
};

export const wreqRequest = async (url: string, options: Record<string, any> = {}): Promise<any> => {
    const response = await wreqFetch(url, {
        ...WREQ_PROFILE,
        ...options,
    });

    if (!response.ok) {
        throw new Error(`Request failed with status code ${response.status}`);
    }

    return response;
};
