import * as PaxTerminal from 'pax-terminal';
import type {
    TransactionEntryModeBitmap,
    DoCreditRequest,
    POSLinkResponse,
} from 'pax-terminal';

// ─── Entry Mode Presets ─────────────────────────────────────────────────────

/** Entry mode presets for each payment method */
export const EntryModePresets = {
    /** QR code scan via terminal scanner */
    qr: {
        manual: false,
        swipe: false,
        chip: false,
        contactless: false,
        scan: true,
    } as TransactionEntryModeBitmap,

    /** NFC / contactless tap */
    nfc: {
        manual: false,
        swipe: false,
        chip: false,
        contactless: true,
        scan: false,
    } as TransactionEntryModeBitmap,

    /** Card swipe + chip insert */
    swipe: {
        manual: false,
        swipe: true,
        chip: true,
        contactless: false,
        scan: false,
    } as TransactionEntryModeBitmap,

    /** All methods enabled (default) */
    all: {
        manual: true,
        swipe: true,
        chip: true,
        contactless: true,
        scan: true,
    } as TransactionEntryModeBitmap,
};

export type PaymentMethod = 'qr' | 'nfc' | 'swipe' | 'all';

// ─── PAX Bridge Service ─────────────────────────────────────────────────────

/**
 * PAX Bridge Service
 * Full-featured wrapper around the PAX Terminal native module
 * Ported from Flutter pos_lite pax_bridge_service.dart
 */
export class PaxBridgeService {
    // ═════════════════════════════════════════════════════════════════════════
    // COMMUNICATION SETTINGS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Configure TCP/IP communication to PAX terminal
     * @param ip IP address of the terminal
     * @param port Port number (default 10009)
     * @param timeout Timeout in seconds (default 30)
     */
    static async setTcpSetting(
        ip: string,
        port: number = 10009,
        timeout: number = 30
    ): Promise<boolean> {
        try {
            const result = await PaxTerminal.setTcpSetting(ip, port, timeout);
            return result === true;
        } catch (e) {
            console.error('PaxBridge.setTcpSetting Error:', e);
            return false;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MANAGEMENT OPERATIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Initialize terminal
     */
    static async init(): Promise<POSLinkResponse> {
        try {
            const resultStr = await PaxTerminal.init();
            const data = JSON.parse(resultStr);
            return PaxBridgeService.parseResponse(data);
        } catch (e) {
            return {
                responseCode: 'ERROR',
                responseMessage: e instanceof Error ? e.message : String(e),
                rawData: {},
                isSuccess: false,
            };
        }
    }

    /**
     * Test connection to terminal (handshake)
     */
    static async handshake(): Promise<boolean> {
        try {
            return await PaxTerminal.handshake();
        } catch (e) {
            console.error('PaxBridge.handshake Error:', e);
            return false;
        }
    }

    /**
     * Cancel current operation
     */
    static async cancel(): Promise<void> {
        try {
            await PaxTerminal.cancel();
        } catch (e) {
            console.error('PaxBridge.cancel Error:', e);
        }
    }

    /**
     * Release terminal instance
     */
    static async remove(): Promise<void> {
        try {
            await PaxTerminal.remove();
        } catch (e) {
            console.error('PaxBridge.remove Error:', e);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TRANSACTION OPERATIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Process Credit card transaction with specific entry mode
     * @param transType Transaction type (SALE, RETURN, VOID, AUTH)
     * @param amount Amount in dollars (e.g. 10.50)
     * @param method Payment method determining entry mode
     * @param ecrRef Optional ECR reference number
     */
    static async doCredit({
        transType = 'SALE',
        amount,
        method = 'all',
        ecrRef,
        tenderType,
    }: {
        transType?: string;
        amount: number;
        method?: PaymentMethod;
        ecrRef?: string;
        tenderType?: string;
    }): Promise<POSLinkResponse> {
        try {
            const entryMode = EntryModePresets[method] || EntryModePresets.all;
            const amountCents = Math.round(amount * 100).toString();

            const request: DoCreditRequest = {
                transactionType: transType,
                tenderType,
                amountInformation: {
                    transactionAmount: amountCents,
                },
                traceInformation: {
                    ecrReferenceNumber: ecrRef || `ECR${Date.now()}`,
                },
                TransactionBehavior: {
                    EntryMode: entryMode,
                },
            };

            const resultStr = await PaxTerminal.doCredit(JSON.stringify(request));
            const data = JSON.parse(resultStr);
            return PaxBridgeService.parseResponse(data);
        } catch (e) {
            return {
                responseCode: 'ERROR',
                responseMessage: e instanceof Error ? e.message : String(e),
                rawData: {},
                isSuccess: false,
            };
        }
    }

    /**
     * Process Debit transaction
     */
    static async doDebit(request: Record<string, any>): Promise<POSLinkResponse> {
        try {
            const resultStr = await PaxTerminal.doDebit(JSON.stringify(request));
            const data = JSON.parse(resultStr);
            return PaxBridgeService.parseResponse(data);
        } catch (e) {
            return {
                responseCode: 'ERROR',
                responseMessage: e instanceof Error ? e.message : String(e),
                rawData: {},
                isSuccess: false,
            };
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BATCH OPERATIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Close current batch
     */
    static async batchClose(): Promise<POSLinkResponse> {
        try {
            const resultStr = await PaxTerminal.batchClose();
            const data = JSON.parse(resultStr);
            return PaxBridgeService.parseResponse(data);
        } catch (e) {
            return {
                responseCode: 'ERROR',
                responseMessage: e instanceof Error ? e.message : String(e),
                rawData: {},
                isSuccess: false,
            };
        }
    }

    /**
     * Get SDK/Plugin version information
     */
    static async getSdkVersion(): Promise<string> {
        try {
            return await PaxTerminal.getSdkVersion();
        } catch (e) {
            console.error('PaxBridge.getSdkVersion Error:', e);
            return 'Version unavailable';
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // LEGACY COMPATIBILITY
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Process payment (legacy method, routes to doCredit with all entry modes)
     */
    static async processPayment(amount: number, referenceNumber: string) {
        try {
            const result = await PaxBridgeService.doCredit({
                transType: 'SALE',
                amount,
                method: 'all',
                ecrRef: referenceNumber,
            });

            return {
                status: result.isSuccess ? 'APPROVED' : 'DECLINED',
                message: result.responseMessage,
                authCode: result.rawData?.hostInformation?.authCode || '',
                referenceNumber:
                    result.rawData?.hostInformation?.hostReferenceNumber || '',
                cardNumber: result.rawData?.accountInformation?.account || '',
                cardType: result.rawData?.accountInformation?.cardType || '',
                approvedAmount:
                    parseFloat(
                        result.rawData?.amountInformation?.approvedAmount || '0'
                    ) / 100,
            };
        } catch (e) {
            console.error('PAX Payment Error:', e);
            return {
                status: 'ERROR',
                message: e instanceof Error ? e.message : String(e),
            };
        }
    }

    /**
     * Check terminal status (legacy)
     */
    static async checkStatus() {
        try {
            const connected = await PaxBridgeService.handshake();
            return { status: connected ? 'READY' : 'ERROR', connected };
        } catch (e) {
            console.error('Error checking status:', e);
            return { status: 'ERROR', connected: false };
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RESPONSE PARSING (matching Flutter POSLinkResponse.fromJson)
    // ═════════════════════════════════════════════════════════════════════════

    private static parseResponse(json: Record<string, any>): POSLinkResponse {
        let code = json.ResponseCode || json.responseCode || 'ERROR';
        let msg =
            json.ResponseMessage || json.responseMessage || 'Unknown Error';

        // Deep check Host Information if top-level is generic
        if (code === 'ERROR' && msg === 'Unknown Error') {
            const hostInfo =
                json.hostInformation || json.HostInformation;
            if (hostInfo) {
                const hostMsg =
                    hostInfo.hostResponseMessage ||
                    hostInfo.HostResponseMessage;
                if (hostMsg && String(hostMsg).length > 0) {
                    msg = String(hostMsg);
                    const hostCode =
                        hostInfo.hostResponseCode ||
                        hostInfo.HostResponseCode;
                    code =
                        hostCode && String(hostCode).length > 0
                            ? String(hostCode)
                            : 'DECLINED';
                }
            }
        }

        return {
            responseCode: code,
            responseMessage: msg,
            rawData: json,
            isSuccess: code === '000000',
        };
    }
}
