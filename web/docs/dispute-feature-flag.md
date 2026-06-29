# Dispute Feature Flag Documentation

## Overview

The dispute functionality now includes a feature flag to control whether mock dispute data is displayed when no real disputes exist in the system. This prevents users from being confused by mock data in production environments.

## Feature Flag

- **Environment Variable**: `NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA`
- **Default Behavior**: Disabled (shows unavailable state when no disputes exist)

## Configuration

### Enable Mock Data (Development/Testing)
```bash
NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA=true
```

### Disable Mock Data (Production)
```bash
NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA=false
# Or simply don't set the variable
```

## Behavior

### When Feature Flag is DISABLED:
- If no real disputes exist: Shows "Dispute Functionality Unavailable" placeholder
- If real disputes exist: Shows the actual disputes normally
- Users cannot create or interact with mock disputes

### When Feature Flag is ENABLED:
- If no real disputes exist: Shows mock dispute data for development/testing
- If real disputes exist: Shows the actual disputes normally (mock data is not used)

## Implementation Details

### Files Modified:
1. `app/lib/feature-flags.ts` - Added feature flag detection
2. `app/lib/disputes/useDisputeManagement.ts` - Updated to respect feature flag
3. `app/components/DisputeManagement.tsx` - Added unavailable state logic
4. `app/components/disputes/DisputeUnavailable.tsx` - New unavailable component
5. `.env.example` - Added feature flag documentation

### Files Added:
1. `tests/lib/disputes/feature-flag.test.tsx` - Component tests
2. `tests/integration/dispute-feature-flag.integration.test.tsx` - Integration tests
3. `docs/dispute-feature-flag.md` - This documentation

## Testing

### Test Cases Covered:
- Feature flag disabled with no disputes → Shows unavailable state
- Feature flag disabled with real disputes → Shows real disputes
- Feature flag enabled with no disputes → Shows mock disputes
- Feature flag enabled with real disputes → Shows real disputes
- Various environment variable values and edge cases

### Running Tests:
```bash
npm test -- tests/integration/dispute-feature-flag.integration.test.tsx
npm test -- tests/lib/disputes/feature-flag.test.tsx
```

## Usage Examples

### Production Environment
```bash
# .env.production
NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA=false
```

### Development Environment
```bash
# .env.local
NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA=true
```

### CI/CD Pipeline
```bash
# Set explicitly to false in production builds
export NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA=false
npm run build
```

## Migration Notes

This change is **backward compatible**:
- Existing behavior is preserved when the feature flag is enabled
- Production environments will now show an appropriate unavailable state instead of mock data
- No breaking changes to the API or component interfaces

## Security Considerations

- The feature flag is client-side only (`NEXT_PUBLIC_` prefix)
- Mock data is never used in production unless explicitly enabled
- Real dispute data always takes precedence over mock data
- The feature flag only affects the display when no real disputes exist
