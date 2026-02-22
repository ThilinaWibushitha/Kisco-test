import { requireNativeModule } from 'expo-modules-core';

// Load native module or fall back to mock for emulator/dev
let PaxTerminalModule: any;
try {
    PaxTerminalModule = requireNativeModule('PaxTerminal');
} catch (e) {
    console.warn('PaxTerminal native module not found. Using mock implementation.');
    PaxTerminalModule = {
        setTcpSetting: async (_ip: string, _port: number, _timeout: number) => {
            console.warn('PaxTerminal.setTcpSetting mock');
            return true;
        },
        init: async () => {
            console.warn('PaxTerminal.init mock');
            return JSON.stringify({ ResponseCode: '000000', ResponseMessage: 'OK' });
        },
        handshake: async () => {
            console.warn('PaxTerminal.handshake mock');
            return true;
        },
        doCredit: async (jsonStr: string) => {
            console.warn('PaxTerminal.doCredit mock:', jsonStr);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return JSON.stringify({
                ResponseCode: '000000',
                ResponseMessage: 'APPROVED',
                hostInformation: {
                    hostResponseCode: '000000',
                    hostResponseMessage: 'APPROVED',
                    hostReferenceNumber: 'MOCK' + Date.now(),
                    authCode: 'MOCK' + Math.floor(Math.random() * 999999),
                },
                accountInformation: {
                    account: '************4242',
                    cardType: 'VISA',
                    entryMode: 'CONTACTLESS',
                },
                amountInformation: {
                    approvedAmount: JSON.parse(jsonStr)?.amountInformation?.transactionAmount || '0',
                },
            });
        },
        doDebit: async (jsonStr: string) => {
            console.warn('PaxTerminal.doDebit mock:', jsonStr);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return JSON.stringify({
                ResponseCode: '000000',
                ResponseMessage: 'APPROVED',
            });
        },
        cancel: async () => {
            console.warn('PaxTerminal.cancel mock');
        },
        batchClose: async () => {
            console.warn('PaxTerminal.batchClose mock');
            return JSON.stringify({ ResponseCode: '000000', ResponseMessage: 'OK' });
        },
        remove: async () => {
            console.warn('PaxTerminal.remove mock');
        },
        getSdkVersion: async () => {
            console.warn('PaxTerminal.getSdkVersion mock');
            return 'Mock SDK v1.0.0';
        },
    };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TransactionEntryModeBitmap {
    manual?: boolean;
    swipe?: boolean;
    chip?: boolean;
    contactless?: boolean;
    scan?: boolean;
}

export interface AmountInformation {
    transactionAmount: string; // Amount in cents as string
    tipAmount?: string;
    cashbackAmount?: string;
    taxAmount?: string;
}

export interface TraceInformation {
    ecrReferenceNumber?: string;
    transactionNumber?: string;
}

export interface TransactionBehavior {
    EntryMode?: TransactionEntryModeBitmap;
}

export interface DoCreditRequest {
    transactionType: string;
    tenderType?: string;
    amountInformation: AmountInformation;
    traceInformation?: TraceInformation;
    TransactionBehavior?: TransactionBehavior;
}

export interface POSLinkResponse {
    responseCode: string;
    responseMessage: string;
    rawData: Record<string, any>;
    isSuccess: boolean;
}

// ─── Exported Functions ─────────────────────────────────────────────────────

/**
 * Configure TCP/IP communication to PAX terminal
 */
export async function setTcpSetting(ip: string, port: number = 10009, timeout: number = 30): Promise<boolean> {
    return await PaxTerminalModule.setTcpSetting(ip, port, timeout);
}

/**
 * Initialize terminal
 */
export async function init(): Promise<string> {
    return await PaxTerminalModule.init();
}

/**
 * Test connection to terminal
 */
export async function handshake(): Promise<boolean> {
    return await PaxTerminalModule.handshake();
}

/**
 * Process Credit transaction (SALE, RETURN, VOID, AUTH)
 * @param jsonStr JSON string of DoCreditRequest
 */
export async function doCredit(jsonStr: string): Promise<string> {
    return await PaxTerminalModule.doCredit(jsonStr);
}

/**
 * Process Debit transaction
 * @param jsonStr JSON string of DoDebitRequest
 */
export async function doDebit(jsonStr: string): Promise<string> {
    return await PaxTerminalModule.doDebit(jsonStr);
}

/**
 * Cancel current operation
 */
export async function cancel(): Promise<void> {
    return await PaxTerminalModule.cancel();
}

/**
 * Close current batch
 */
export async function batchClose(jsonStr: string = '{}'): Promise<string> {
    return await PaxTerminalModule.batchClose(jsonStr);
}

/**
 * Release terminal instance
 */
export async function remove(): Promise<void> {
    return await PaxTerminalModule.remove();
}

/**
 * Get SDK version
 */
export async function getSdkVersion(): Promise<string> {
    return await PaxTerminalModule.getSdkVersion();
}

// Legacy exports for backward compatibility
export async function initialize(ip: string, port: number): Promise<boolean> {
    return await setTcpSetting(ip, port);
}

export async function processPayment(request: any): Promise<any> {
    const amountCents = Math.round((request.amount || 0) * 100).toString();
    const creditReq: DoCreditRequest = {
        transactionType: request.transactionType || 'SALE',
        amountInformation: { transactionAmount: amountCents },
        traceInformation: { ecrReferenceNumber: request.referenceNumber },
        TransactionBehavior: {
            EntryMode: { manual: true, swipe: true, chip: true, contactless: true, scan: true },
        },
    };
    const resultStr = await doCredit(JSON.stringify(creditReq));
    const result = JSON.parse(resultStr);

    const code = result.ResponseCode || result.responseCode || 'ERROR';
    const hostInfo = result.hostInformation || result.HostInformation || {};
    const acctInfo = result.accountInformation || result.AccountInformation || {};
    const amtInfo = result.amountInformation || result.AmountInformation || {};

    return {
        status: code === '000000' ? 'APPROVED' : 'DECLINED',
        authCode: hostInfo.authCode || hostInfo.AuthCode || '',
        referenceNumber: hostInfo.hostReferenceNumber || hostInfo.HostReferenceNumber || '',
        cardNumber: acctInfo.account || acctInfo.Account || '',
        cardType: acctInfo.cardType || acctInfo.CardType || '',
        message: result.ResponseMessage || result.responseMessage || '',
        approvedAmount: parseFloat(amtInfo.approvedAmount || amtInfo.ApprovedAmount || '0') / 100,
    };
}

export async function checkStatus(): Promise<{ status: string; connected: boolean }> {
    try {
        const ok = await handshake();
        return { status: ok ? 'READY' : 'ERROR', connected: ok };
    } catch (e) {
        return { status: 'ERROR', connected: false };
    }
}
