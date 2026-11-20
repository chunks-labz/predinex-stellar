/**
 * Institutional Compliance and Regulatory Engine.
 */

import {
  ComplianceAction,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ComplianceRecordDto,
  ComplianceTier,
  RegisterParticipantRequest,
} from '../types/index.js';

export class ComplianceEngine {
  private records = new Map<string, ComplianceRecordDto>();
  private blockedCountries = new Set<number>([408, 364, 760]); // e.g. Sanctioned ISO codes

  constructor() {
    // Seed test participant
    this.records.set('GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K'.toLowerCase(), {
      participant: 'GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K',
      tier: 'Tier2_Accredited',
      kycExpiry: Math.floor(Date.now() / 1000) + 31_536_000,
      jurisdictionCode: 840, // USA
      isSanctioned: false,
      isFrozen: false,
      dailyVolumeLimitUsd: 250_000,
      dailyVolumeUsedUsd: 0,
      lastResetTimestamp: Math.floor(Date.now() / 1000),
    });
  }

  public registerParticipant(request: RegisterParticipantRequest): ComplianceRecordDto {
    const limits: Record<ComplianceTier, number> = {
      'Tier0_Unverified': 0,
      'Tier1_Retail': 10_000,
      'Tier2_Accredited': 250_000,
      'Tier3_Institutional': 10_000_000,
    };

    const record: ComplianceRecordDto = {
      participant: request.participantAddress,
      tier: request.tier,
      kycExpiry: request.kycExpiryTimestamp,
      jurisdictionCode: request.jurisdictionCode,
      isSanctioned: false,
      isFrozen: false,
      dailyVolumeLimitUsd: request.customDailyLimitUsd ?? limits[request.tier],
      dailyVolumeUsedUsd: 0,
      lastResetTimestamp: Math.floor(Date.now() / 1000),
    };

    this.records.set(request.participantAddress.toLowerCase(), record);
    return record;
  }

  public setSanctionStatus(address: string, isSanctioned: boolean): boolean {
    const record = this.records.get(address.toLowerCase());
    if (!record) return false;
    record.isSanctioned = isSanctioned;
    return true;
  }

  public setFrozenStatus(address: string, isFrozen: boolean): boolean {
    const record = this.records.get(address.toLowerCase());
    if (!record) return false;
    record.isFrozen = isFrozen;
    return true;
  }

  public getRecord(address: string): ComplianceRecordDto | undefined {
    return this.records.get(address.toLowerCase());
  }

  public verifyTransaction(
    request: ComplianceCheckRequest,
    now: number = Math.floor(Date.now() / 1000)
  ): ComplianceCheckResponse {
    const checkedAt = Date.now();
    const record = this.records.get(request.participantAddress.toLowerCase());

    if (!record || record.tier === 'Tier0_Unverified') {
      return {
        isAllowed: false,
        participant: request.participantAddress,
        tier: 'Tier0_Unverified',
        dailyRemainingUsd: 0,
        dailyLimitUsd: 0,
        errorCode: 3,
        reason: 'Participant is not KYC verified',
        checkedAt,
      };
    }

    if (now >= record.kycExpiry) {
      return {
        isAllowed: false,
        participant: request.participantAddress,
        tier: record.tier,
        dailyRemainingUsd: 0,
        dailyLimitUsd: record.dailyVolumeLimitUsd,
        errorCode: 4,
        reason: 'Participant KYC verification has expired',
        checkedAt,
      };
    }

    if (record.isSanctioned) {
      return {
        isAllowed: false,
        participant: request.participantAddress,
        tier: record.tier,
        dailyRemainingUsd: 0,
        dailyLimitUsd: record.dailyVolumeLimitUsd,
        errorCode: 5,
        reason: 'Participant is flagged on the sanctions list',
        checkedAt,
      };
    }

    if (record.isFrozen) {
      return {
        isAllowed: false,
        participant: request.participantAddress,
        tier: record.tier,
        dailyRemainingUsd: 0,
        dailyLimitUsd: record.dailyVolumeLimitUsd,
        errorCode: 6,
        reason: 'Participant account is temporarily frozen',
        checkedAt,
      };
    }

    if (this.blockedCountries.has(record.jurisdictionCode)) {
      return {
        isAllowed: false,
        participant: request.participantAddress,
        tier: record.tier,
        dailyRemainingUsd: 0,
        dailyLimitUsd: record.dailyVolumeLimitUsd,
        errorCode: 8,
        reason: 'Jurisdiction is restricted by regulatory policy',
        checkedAt,
      };
    }

    // Reset rolling 24h window
    if (now - record.lastResetTimestamp >= 86_400) {
      record.dailyVolumeUsedUsd = 0;
      record.lastResetTimestamp = now;
    }

    const proposedUsed = record.dailyVolumeUsedUsd + request.amountUsd;
    if (proposedUsed > record.dailyVolumeLimitUsd) {
      const remaining = Math.max(0, record.dailyVolumeLimitUsd - record.dailyVolumeUsedUsd);
      return {
        isAllowed: false,
        participant: request.participantAddress,
        tier: record.tier,
        dailyRemainingUsd: remaining,
        dailyLimitUsd: record.dailyVolumeLimitUsd,
        errorCode: 7,
        reason: `Transaction amount exceeds remaining daily limit ($${remaining.toLocaleString()})`,
        checkedAt,
      };
    }

    // Record usage
    record.dailyVolumeUsedUsd = proposedUsed;
    const remaining = record.dailyVolumeLimitUsd - proposedUsed;

    return {
      isAllowed: true,
      participant: request.participantAddress,
      tier: record.tier,
      dailyRemainingUsd: remaining,
      dailyLimitUsd: record.dailyVolumeLimitUsd,
      checkedAt,
    };
  }
}
