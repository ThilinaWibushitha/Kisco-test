/**
 * Payment Screen (Step 6) - Card / Gift Card payment
 * Shows order summary and initiates payment via PAX terminal
 * Supports QR Code, NFC (Contactless), and Swipe/Insert methods
 */

import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { GiftCardService } from "@/src/services/giftCardService";
import { PaxBridgeService, type PaymentMethod } from "@/src/services/paxBridgeService";
import { useKiosk } from "@/src/store/kioskStore";
import { formatCurrency } from "@/src/utils/cartUtils";

type PaymentStep =
    | "select"
    | "card_method_select"
    | "card_processing"
    | "gift_card_entry"
    | "gift_card_processing";

const CARD_METHODS: { key: PaymentMethod; icon: string; title: string; subtitle: string }[] = [
    {
        key: "qr",
        icon: "📱",
        title: "QR Code Pay",
        subtitle: "Scan QR code on the terminal",
    },
    {
        key: "nfc",
        icon: "📶",
        title: "Tap to Pay (NFC)",
        subtitle: "Hold your card or phone near terminal",
    },
    {
        key: "swipe",
        icon: "💳",
        title: "Swipe / Insert Card",
        subtitle: "Swipe or insert your card",
    },
];

const METHOD_INSTRUCTIONS: Record<PaymentMethod, string> = {
    qr: "Please scan the QR code displayed on the terminal",
    nfc: "Hold your card or phone near the terminal reader",
    swipe: "Please swipe or insert your card into the terminal",
    all: "Please use the terminal to complete payment",
};

export default function PaymentScreen() {
    const router = useRouter();
    const { state, subtotal, taxTotal, grandTotal, submitOrder, cartItemCount } =
        useKiosk();

    const [paymentStep, setPaymentStep] = useState<PaymentStep>("select");
    const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("all");
    const [giftCardNumber, setGiftCardNumber] = useState("");
    const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Card Payment (PAX Terminal) ──
    const handleCardPayment = useCallback(
        async (method: PaymentMethod) => {
            setSelectedMethod(method);
            setPaymentStep("card_processing");
            setIsProcessing(true);
            setError(null);

            try {
                console.log(
                    `Initiating PAX card payment via ${method} for:`,
                    grandTotal
                );

                const ecrRef = `REF${Date.now()}`;

                // Process payment via PAX Bridge with specific entry mode
                const result = await PaxBridgeService.doCredit({
                    transType: "SALE",
                    amount: grandTotal,
                    method,
                    ecrRef,
                });

                if (!result.isSuccess) {
                    throw new Error(result.responseMessage || "Payment Declined");
                }

                // Extract details from raw response
                const hostInfo = result.rawData?.hostInformation || {};
                const acctInfo = result.rawData?.accountInformation || {};
                const amtInfo = result.rawData?.amountInformation || {};

                const paymentDetails = {
                    cardNumber: acctInfo.account || "****4242",
                    cardType: acctInfo.cardType || "CARD",
                    cardHolder: "CUSTOMER",
                    retref: hostInfo.hostReferenceNumber || ecrRef,
                    entryMethod:
                        acctInfo.entryMode || method.toUpperCase(),
                    accountType: "CREDIT",
                    hostRefNum: hostInfo.authCode || "",
                    deviceOrgRefNum: `D${Date.now()}`,
                    approvedAmount:
                        parseFloat(amtInfo.approvedAmount || "0") / 100 ||
                        grandTotal,
                };

                const success = await submitOrder("card", paymentDetails);

                if (success) {
                    router.replace("/(order)/order-complete");
                } else {
                    setError("Order submission failed. Please try again.");
                    setPaymentStep("card_method_select");
                }
            } catch (e) {
                console.log("Card payment error:", e);
                setError(
                    e instanceof Error
                        ? e.message
                        : "Payment failed. Please try again."
                );
                setPaymentStep("card_method_select");
            } finally {
                setIsProcessing(false);
            }
        },
        [grandTotal, submitOrder, router]
    );

    // ── Gift Card Check Balance ──
    const handleGiftCardBalanceCheck = useCallback(async () => {
        if (!giftCardNumber || giftCardNumber.length < 4) {
            setError("Please enter a valid gift card number");
            return;
        }

        setIsProcessing(true);
        setError(null);

        try {
            const result = await GiftCardService.checkBalance(giftCardNumber);

            if (result && result.status) {
                setGiftCardBalance(result.balance);

                if (result.balance < grandTotal) {
                    setError(
                        `Gift card balance ($${result.balance.toFixed(
                            2
                        )}) is insufficient. Total: ${formatCurrency(grandTotal)}`
                    );
                }
            } else {
                setError(
                    "Unable to verify gift card. Please check the number and try again."
                );
            }
        } catch (e) {
            setError("Failed to check gift card balance.");
        } finally {
            setIsProcessing(false);
        }
    }, [giftCardNumber, grandTotal]);

    // ── Gift Card Redeem ──
    const handleGiftCardRedeem = useCallback(async () => {
        if (giftCardBalance === null || giftCardBalance < grandTotal) {
            setError("Insufficient gift card balance.");
            return;
        }

        setPaymentStep("gift_card_processing");
        setIsProcessing(true);
        setError(null);

        try {
            const result = await GiftCardService.redeem({
                cardToken: giftCardNumber,
                amount: grandTotal,
            });

            if (result && result.status) {
                const paymentDetails = {
                    giftCardNumber: GiftCardService.maskCardNumber(giftCardNumber),
                    hostRefNum: result.hostRef,
                    approvedAmount: result.approvedBalance,
                    newBalance: result.newBalance,
                };

                const success = await submitOrder("gift_card", paymentDetails);

                if (success) {
                    router.replace("/(order)/order-complete");
                } else {
                    setError("Order submission failed after payment.");
                    setPaymentStep("select");
                }
            } else {
                setError(result?.description || "Gift card redemption failed.");
                setPaymentStep("gift_card_entry");
            }
        } catch (e) {
            setError("Payment processing failed.");
            setPaymentStep("gift_card_entry");
        } finally {
            setIsProcessing(false);
        }
    }, [giftCardNumber, giftCardBalance, grandTotal, submitOrder, router]);

    // ── Cancel Payment ──
    const handleCancel = useCallback(() => {
        if (isProcessing) {
            Alert.alert(
                "Cancel Payment?",
                "Are you sure you want to cancel this payment?",
                [
                    { text: "No", style: "cancel" },
                    {
                        text: "Yes, Cancel",
                        style: "destructive",
                        onPress: async () => {
                            try {
                                await PaxBridgeService.cancel();
                            } catch (e) { }
                            setIsProcessing(false);
                            setPaymentStep("select");
                            setError(null);
                        },
                    },
                ]
            );
        } else {
            router.back();
        }
    }, [isProcessing, router]);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={handleCancel}>
                    <Text style={styles.backButtonText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Payment</Text>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Order Summary Card */}
                <View style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>Order Summary</Text>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>
                            {cartItemCount} item{cartItemCount !== 1 ? "s" : ""}
                        </Text>
                        <Text style={styles.summaryValue}>
                            {formatCurrency(subtotal)}
                        </Text>
                    </View>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Tax</Text>
                        <Text style={styles.summaryValue}>
                            {formatCurrency(taxTotal)}
                        </Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.summaryRow}>
                        <Text style={styles.totalLabel}>Total</Text>
                        <Text style={styles.totalValue}>
                            {formatCurrency(grandTotal)}
                        </Text>
                    </View>
                    {state.customerName && (
                        <View style={styles.customerRow}>
                            <Text style={styles.customerLabel}>Name</Text>
                            <Text style={styles.customerValue}>
                                {state.customerName}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Error Message */}
                {error && (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                {/* ═══ Payment Type Selection (Card vs Gift Card) ═══ */}
                {paymentStep === "select" && (
                    <View style={styles.paymentMethods}>
                        <Text style={styles.selectTitle}>
                            Select Payment Method
                        </Text>

                        {/* Card Payment → shows sub-methods */}
                        <TouchableOpacity
                            style={styles.paymentOption}
                            onPress={() => setPaymentStep("card_method_select")}
                            activeOpacity={0.8}
                        >
                            <View style={styles.paymentOptionIcon}>
                                <Text style={styles.paymentOptionIconText}>
                                    💳
                                </Text>
                            </View>
                            <View style={styles.paymentOptionInfo}>
                                <Text style={styles.paymentOptionTitle}>
                                    Credit / Debit Card
                                </Text>
                                <Text style={styles.paymentOptionSubtitle}>
                                    QR, NFC tap, or swipe / insert
                                </Text>
                            </View>
                            <Text style={styles.paymentOptionArrow}>→</Text>
                        </TouchableOpacity>

                        {/* Gift Card Payment */}
                        <TouchableOpacity
                            style={styles.paymentOption}
                            onPress={() => setPaymentStep("gift_card_entry")}
                            activeOpacity={0.8}
                        >
                            <View style={styles.paymentOptionIcon}>
                                <Text style={styles.paymentOptionIconText}>
                                    🎁
                                </Text>
                            </View>
                            <View style={styles.paymentOptionInfo}>
                                <Text style={styles.paymentOptionTitle}>
                                    Gift Card
                                </Text>
                                <Text style={styles.paymentOptionSubtitle}>
                                    Pay with an in-house gift card
                                </Text>
                            </View>
                            <Text style={styles.paymentOptionArrow}>→</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* ═══ Card Method Selection (QR / NFC / Swipe) ═══ */}
                {paymentStep === "card_method_select" && (
                    <View style={styles.paymentMethods}>
                        <Text style={styles.selectTitle}>
                            How would you like to pay?
                        </Text>

                        {CARD_METHODS.map((m) => (
                            <TouchableOpacity
                                key={m.key}
                                style={[
                                    styles.paymentOption,
                                    m.key === "nfc" && styles.paymentOptionHighlight,
                                ]}
                                onPress={() => handleCardPayment(m.key)}
                                activeOpacity={0.8}
                            >
                                <View
                                    style={[
                                        styles.paymentOptionIcon,
                                        m.key === "nfc" &&
                                        styles.paymentOptionIconHighlight,
                                    ]}
                                >
                                    <Text style={styles.paymentOptionIconText}>
                                        {m.icon}
                                    </Text>
                                </View>
                                <View style={styles.paymentOptionInfo}>
                                    <Text style={styles.paymentOptionTitle}>
                                        {m.title}
                                    </Text>
                                    <Text style={styles.paymentOptionSubtitle}>
                                        {m.subtitle}
                                    </Text>
                                </View>
                                <Text style={styles.paymentOptionArrow}>→</Text>
                            </TouchableOpacity>
                        ))}

                        <TouchableOpacity
                            style={styles.backToMethodsButton}
                            onPress={() => {
                                setPaymentStep("select");
                                setError(null);
                            }}
                        >
                            <Text style={styles.backToMethodsText}>
                                ← Back to payment methods
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* ═══ Card Processing ═══ */}
                {paymentStep === "card_processing" && (
                    <View style={styles.processingContainer}>
                        <View style={styles.processingCard}>
                            <ActivityIndicator size="large" color="#ff3b30" />
                            <Text style={styles.processingTitle}>
                                Processing Payment
                            </Text>
                            <Text style={styles.processingSubtitle}>
                                {METHOD_INSTRUCTIONS[selectedMethod]}
                            </Text>
                            <Text style={styles.processingAmount}>
                                {formatCurrency(grandTotal)}
                            </Text>

                            {/* Method badge */}
                            <View style={styles.methodBadge}>
                                <Text style={styles.methodBadgeText}>
                                    {CARD_METHODS.find(
                                        (m) => m.key === selectedMethod
                                    )?.icon || "💳"}{" "}
                                    {CARD_METHODS.find(
                                        (m) => m.key === selectedMethod
                                    )?.title || "Card"}
                                </Text>
                            </View>

                            <TouchableOpacity
                                style={styles.cancelPaymentButton}
                                onPress={handleCancel}
                            >
                                <Text style={styles.cancelPaymentText}>
                                    Cancel
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {/* ═══ Gift Card Entry ═══ */}
                {paymentStep === "gift_card_entry" && (
                    <View style={styles.giftCardContainer}>
                        <Text style={styles.giftCardTitle}>
                            Enter Gift Card Number
                        </Text>

                        <TextInput
                            style={styles.giftCardInput}
                            placeholder="Gift card number"
                            placeholderTextColor="#636366"
                            value={giftCardNumber}
                            onChangeText={(text) => {
                                setGiftCardNumber(text);
                                setGiftCardBalance(null);
                                setError(null);
                            }}
                            keyboardType="number-pad"
                            maxLength={22}
                            autoFocus
                        />

                        {giftCardBalance !== null && (
                            <View style={styles.balanceCard}>
                                <Text style={styles.balanceLabel}>
                                    Available Balance
                                </Text>
                                <Text
                                    style={[
                                        styles.balanceAmount,
                                        giftCardBalance < grandTotal &&
                                        styles.balanceInsufficient,
                                    ]}
                                >
                                    {formatCurrency(giftCardBalance)}
                                </Text>
                            </View>
                        )}

                        <View style={styles.giftCardButtons}>
                            {giftCardBalance === null ? (
                                <TouchableOpacity
                                    style={[
                                        styles.checkBalanceButton,
                                        giftCardNumber.length < 4 &&
                                        styles.buttonDisabled,
                                    ]}
                                    onPress={handleGiftCardBalanceCheck}
                                    disabled={
                                        isProcessing || giftCardNumber.length < 4
                                    }
                                    activeOpacity={0.85}
                                >
                                    {isProcessing ? (
                                        <ActivityIndicator color="#ffffff" />
                                    ) : (
                                        <Text style={styles.checkBalanceText}>
                                            Check Balance
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            ) : (
                                <TouchableOpacity
                                    style={[
                                        styles.redeemButton,
                                        giftCardBalance < grandTotal &&
                                        styles.buttonDisabled,
                                    ]}
                                    onPress={handleGiftCardRedeem}
                                    disabled={giftCardBalance < grandTotal}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.redeemText}>
                                        Pay {formatCurrency(grandTotal)}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity
                                style={styles.backToMethodsButton}
                                onPress={() => {
                                    setPaymentStep("select");
                                    setGiftCardNumber("");
                                    setGiftCardBalance(null);
                                    setError(null);
                                }}
                            >
                                <Text style={styles.backToMethodsText}>
                                    ← Choose different payment
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {/* ═══ Gift Card Processing ═══ */}
                {paymentStep === "gift_card_processing" && (
                    <View style={styles.processingContainer}>
                        <View style={styles.processingCard}>
                            <ActivityIndicator size="large" color="#ff3b30" />
                            <Text style={styles.processingTitle}>
                                Processing Gift Card
                            </Text>
                            <Text style={styles.processingSubtitle}>
                                Please wait while we process your payment...
                            </Text>
                            <Text style={styles.processingAmount}>
                                {formatCurrency(grandTotal)}
                            </Text>
                        </View>
                    </View>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#0f0f13",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 50,
        paddingBottom: 16,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: "#1a1a24",
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#2e2e3a",
    },
    backButtonText: {
        color: "#ffffff",
        fontSize: 22,
        fontWeight: "600",
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: "800",
        color: "#ffffff",
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 24,
        paddingBottom: 40,
    },
    summaryCard: {
        backgroundColor: "#1a1a24",
        borderRadius: 20,
        padding: 24,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: "#2e2e3a",
    },
    summaryTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: "#ffffff",
        marginBottom: 16,
    },
    summaryRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 10,
    },
    summaryLabel: {
        fontSize: 15,
        color: "#8e8e93",
        fontWeight: "500",
    },
    summaryValue: {
        fontSize: 15,
        color: "#ffffff",
        fontWeight: "600",
    },
    divider: {
        height: 1,
        backgroundColor: "#2e2e3a",
        marginVertical: 12,
    },
    totalLabel: {
        fontSize: 19,
        fontWeight: "800",
        color: "#ffffff",
    },
    totalValue: {
        fontSize: 22,
        fontWeight: "800",
        color: "#ff3b30",
    },
    customerRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: "#2e2e3a",
    },
    customerLabel: {
        fontSize: 14,
        color: "#8e8e93",
        fontWeight: "500",
    },
    customerValue: {
        fontSize: 14,
        color: "#ffffff",
        fontWeight: "600",
    },
    errorContainer: {
        backgroundColor: "rgba(255, 59, 48, 0.1)",
        borderRadius: 14,
        padding: 16,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: "rgba(255, 59, 48, 0.2)",
    },
    errorText: {
        color: "#ff6b5e",
        fontSize: 14,
        fontWeight: "500",
        textAlign: "center",
        lineHeight: 20,
    },
    paymentMethods: {
        gap: 14,
    },
    selectTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: "#ffffff",
        marginBottom: 4,
    },
    paymentOption: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#1a1a24",
        borderRadius: 20,
        padding: 22,
        borderWidth: 1,
        borderColor: "#2e2e3a",
    },
    paymentOptionHighlight: {
        borderColor: "rgba(255, 59, 48, 0.4)",
        backgroundColor: "#1e1a24",
    },
    paymentOptionIcon: {
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: "#22222e",
        justifyContent: "center",
        alignItems: "center",
        marginRight: 16,
    },
    paymentOptionIconHighlight: {
        backgroundColor: "rgba(255, 59, 48, 0.15)",
    },
    paymentOptionIconText: {
        fontSize: 24,
    },
    paymentOptionInfo: {
        flex: 1,
    },
    paymentOptionTitle: {
        fontSize: 17,
        fontWeight: "700",
        color: "#ffffff",
        marginBottom: 4,
    },
    paymentOptionSubtitle: {
        fontSize: 13,
        color: "#8e8e93",
        fontWeight: "500",
    },
    paymentOptionArrow: {
        fontSize: 20,
        color: "#636366",
        fontWeight: "600",
    },
    processingContainer: {
        paddingTop: 20,
    },
    processingCard: {
        backgroundColor: "#1a1a24",
        borderRadius: 24,
        padding: 48,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#2e2e3a",
    },
    processingTitle: {
        fontSize: 22,
        fontWeight: "800",
        color: "#ffffff",
        marginTop: 24,
        marginBottom: 12,
    },
    processingSubtitle: {
        fontSize: 15,
        color: "#8e8e93",
        textAlign: "center",
        lineHeight: 22,
        marginBottom: 20,
    },
    processingAmount: {
        fontSize: 36,
        fontWeight: "800",
        color: "#ff3b30",
        marginBottom: 24,
    },
    methodBadge: {
        backgroundColor: "#22222e",
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: "#2e2e3a",
    },
    methodBadgeText: {
        color: "#8e8e93",
        fontSize: 14,
        fontWeight: "600",
    },
    cancelPaymentButton: {
        paddingHorizontal: 32,
        paddingVertical: 14,
        borderRadius: 14,
        backgroundColor: "#22222e",
        borderWidth: 1,
        borderColor: "#2e2e3a",
    },
    cancelPaymentText: {
        color: "#ff3b30",
        fontSize: 16,
        fontWeight: "600",
    },
    giftCardContainer: {
        paddingTop: 4,
    },
    giftCardTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#ffffff",
        marginBottom: 20,
    },
    giftCardInput: {
        backgroundColor: "#1a1a24",
        borderRadius: 18,
        padding: 20,
        fontSize: 20,
        fontWeight: "700",
        color: "#ffffff",
        textAlign: "center",
        borderWidth: 1,
        borderColor: "#2e2e3a",
        letterSpacing: 2,
        marginBottom: 20,
    },
    balanceCard: {
        backgroundColor: "#22222e",
        borderRadius: 16,
        padding: 20,
        alignItems: "center",
        marginBottom: 20,
        borderWidth: 1,
        borderColor: "#2e2e3a",
    },
    balanceLabel: {
        fontSize: 14,
        color: "#8e8e93",
        fontWeight: "500",
        marginBottom: 8,
    },
    balanceAmount: {
        fontSize: 28,
        fontWeight: "800",
        color: "#34c759",
    },
    balanceInsufficient: {
        color: "#ff3b30",
    },
    giftCardButtons: {
        gap: 12,
    },
    checkBalanceButton: {
        backgroundColor: "#ff3b30",
        borderRadius: 18,
        padding: 18,
        alignItems: "center",
    },
    buttonDisabled: {
        backgroundColor: "#3a3a4a",
    },
    checkBalanceText: {
        color: "#ffffff",
        fontSize: 17,
        fontWeight: "700",
    },
    redeemButton: {
        backgroundColor: "#34c759",
        borderRadius: 18,
        padding: 18,
        alignItems: "center",
    },
    redeemText: {
        color: "#ffffff",
        fontSize: 17,
        fontWeight: "700",
    },
    backToMethodsButton: {
        padding: 16,
        alignItems: "center",
    },
    backToMethodsText: {
        color: "#8e8e93",
        fontSize: 15,
        fontWeight: "600",
    },
});
