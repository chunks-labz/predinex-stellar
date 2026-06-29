# Requirements Document: Real-Time Odds Chart

## Introduction

This document specifies the requirements for implementing a real-time odds chart component on the pool detail page. The chart visualizes the historical implied probability for both outcomes in a prediction market, enabling users to make informed betting decisions based on market trends over time. The chart is built from indexed `place_bet` event data retrieved from the Stellar blockchain via Soroban RPC calls.

## Glossary

- **Odds_Chart**: A React component that renders a line chart displaying implied probability over time for prediction market outcomes
- **Pool_Detail_Page**: The Next.js page that displays detailed information about a specific prediction market pool
- **Implied_Probability**: The probability of an outcome occurring, calculated from the current pool distribution (outcome_amount / total_pool_amount × 100%)
- **Place_Bet_Event**: Blockchain event data emitted when a user places a bet on a prediction market outcome via Soroban smart contract
- **Outcome_A**: The first outcome option in a binary prediction market
- **Outcome_B**: The second outcome option in a binary prediction market
- **Time_Series_Data**: An ordered collection of data points consisting of timestamp and implied probability pairs
- **Chart_Tooltip**: An interactive overlay that displays detailed information when a user hovers over a data point
- **Loading_State**: A visual indicator displayed while chart data is being fetched from the blockchain
- **Empty_State**: A visual indicator displayed when no historical bet data exists for the pool
- **ARIA**: Accessible Rich Internet Applications specification for making web content accessible to users with disabilities
- **Soroban_RPC**: Remote Procedure Call interface for querying data from Stellar blockchain smart contracts

## Requirements

### Requirement 1: Chart Data Retrieval

**User Story:** As a user, I want the chart to display historical odds data from the blockchain, so that I can see how market sentiment has evolved over time.

#### Acceptance Criteria

1. WHEN the Pool_Detail_Page loads, THE Odds_Chart SHALL fetch Place_Bet_Event data via Soroban_RPC
2. THE Odds_Chart SHALL transform Place_Bet_Event data into Time_Series_Data with timestamp and Implied_Probability values
3. THE Odds_Chart SHALL calculate Implied_Probability for Outcome_A as (outcome_a_amount / total_pool_amount × 100)
4. THE Odds_Chart SHALL calculate Implied_Probability for Outcome_B as (outcome_b_amount / total_pool_amount × 100)
5. WHEN Place_Bet_Event data is unavailable, THE Odds_Chart SHALL display the Empty_State

### Requirement 2: Chart Visual Representation

**User Story:** As a user, I want to see a clear line chart with time on the X-axis and probability on the Y-axis, so that I can quickly understand market trends.

#### Acceptance Criteria

1. THE Odds_Chart SHALL render a line chart with time on the X-axis
2. THE Odds_Chart SHALL render Implied_Probability values on the Y-axis ranging from 0 to 100 percent
3. THE Odds_Chart SHALL display a distinct line for Outcome_A
4. THE Odds_Chart SHALL display a distinct line for Outcome_B
5. THE Odds_Chart SHALL use contrasting colors for Outcome_A and Outcome_B lines to ensure visual distinction
6. THE Odds_Chart SHALL apply glassmorphism design patterns consistent with existing Predinex components

### Requirement 3: Interactive Tooltip

**User Story:** As a user, I want to see detailed information when I hover over a data point, so that I can examine specific probability values at particular times.

#### Acceptance Criteria

1. WHEN a user hovers over a data point, THE Odds_Chart SHALL display a Chart_Tooltip
2. THE Chart_Tooltip SHALL show the timestamp of the data point
3. THE Chart_Tooltip SHALL show the Implied_Probability value for Outcome_A at that timestamp
4. THE Chart_Tooltip SHALL show the Implied_Probability value for Outcome_B at that timestamp
5. WHEN a user moves the cursor away from the data point, THE Odds_Chart SHALL hide the Chart_Tooltip

### Requirement 4: Loading State Handling

**User Story:** As a user, I want to see a loading indicator while chart data is being fetched, so that I know the system is working and data will appear.

#### Acceptance Criteria

1. WHEN the Odds_Chart begins fetching Place_Bet_Event data, THE Odds_Chart SHALL display the Loading_State
2. THE Loading_State SHALL use the `animate-pulse` skeleton pattern consistent with existing Predinex components
3. WHEN Place_Bet_Event data fetch completes successfully, THE Odds_Chart SHALL hide the Loading_State and display the chart
4. WHEN Place_Bet_Event data fetch fails, THE Odds_Chart SHALL hide the Loading_State and display an error message

### Requirement 5: Empty State Handling

**User Story:** As a user, I want to see a clear message when no historical data exists, so that I understand why the chart is not displayed.

#### Acceptance Criteria

1. WHEN no Place_Bet_Event data exists for the pool, THE Odds_Chart SHALL display the Empty_State
2. THE Empty_State SHALL include a message indicating no historical bet data is available
3. THE Empty_State SHALL use the EmptyState component pattern consistent with existing Predinex components

### Requirement 6: Accessibility Compliance

**User Story:** As a user with disabilities, I want the chart to be accessible via screen readers and keyboard navigation, so that I can access the same information as other users.

#### Acceptance Criteria

1. THE Odds_Chart SHALL include ARIA labels describing the chart purpose
2. THE Odds_Chart SHALL include ARIA labels for the X-axis indicating it represents time
3. THE Odds_Chart SHALL include ARIA labels for the Y-axis indicating it represents Implied_Probability percentage
4. THE Odds_Chart SHALL provide a text alternative summarizing the chart data for screen reader users
5. WHEN a user navigates via keyboard, THE Odds_Chart SHALL provide accessible focus indicators

### Requirement 7: Responsive Design

**User Story:** As a user on a mobile device, I want the chart to adapt to my screen size, so that I can view market trends on any device.

#### Acceptance Criteria

1. THE Odds_Chart SHALL render at full container width on all screen sizes
2. WHEN displayed on mobile devices (width < 768px), THE Odds_Chart SHALL adjust axis labels for readability
3. WHEN displayed on mobile devices (width < 768px), THE Chart_Tooltip SHALL position itself to remain visible within the viewport
4. THE Odds_Chart SHALL use Tailwind CSS responsive utilities consistent with existing Predinex components

### Requirement 8: Integration with Pool Detail Page

**User Story:** As a user viewing a pool detail page, I want the odds chart to be prominently displayed, so that I can easily access historical market data.

#### Acceptance Criteria

1. THE Pool_Detail_Page SHALL include the Odds_Chart component
2. THE Odds_Chart SHALL receive the pool identifier as a prop from the Pool_Detail_Page
3. THE Odds_Chart SHALL be positioned below the pool summary information and above the betting section
4. THE Odds_Chart SHALL maintain consistent spacing with other Pool_Detail_Page components using Tailwind CSS spacing utilities

### Requirement 9: Performance Optimization

**User Story:** As a user, I want the chart to load quickly and not impact page performance, so that I have a smooth browsing experience.

#### Acceptance Criteria

1. THE Odds_Chart SHALL fetch Place_Bet_Event data only once per page load
2. THE Odds_Chart SHALL cache Time_Series_Data to avoid redundant calculations
3. WHEN the pool identifier changes, THE Odds_Chart SHALL clear cached data and fetch new Place_Bet_Event data
4. THE Odds_Chart SHALL render using React 19 performance optimizations (memoization where appropriate)

### Requirement 10: Error Handling

**User Story:** As a user, I want to see clear error messages when chart data cannot be loaded, so that I understand what went wrong and can take appropriate action.

#### Acceptance Criteria

1. WHEN Soroban_RPC fetch fails, THE Odds_Chart SHALL display an error message
2. THE error message SHALL indicate that blockchain data could not be retrieved
3. THE error message SHALL provide a retry action for the user
4. WHEN the user triggers retry, THE Odds_Chart SHALL attempt to fetch Place_Bet_Event data again
5. THE Odds_Chart SHALL log errors to the browser console for debugging purposes
