'use client';

import React from 'react';

export function DisputeUnavailable() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="text-center py-12">
        <div className="mb-6">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">
            Dispute Functionality Unavailable
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            The dispute system is currently not available. This feature is either under development or has been temporarily disabled.
          </p>
        </div>
        
        <div className="bg-muted/50 rounded-lg p-6 max-w-2xl mx-auto text-left">
          <h3 className="font-medium text-foreground mb-3">What this means:</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start">
              <span className="w-2 h-2 bg-muted-foreground rounded-full mt-1.5 mr-3 flex-shrink-0"></span>
              You cannot view existing disputes
            </li>
            <li className="flex items-start">
              <span className="w-2 h-2 bg-muted-foreground rounded-full mt-1.5 mr-3 flex-shrink-0"></span>
              You cannot create new disputes
            </li>
            <li className="flex items-start">
              <span className="w-2 h-2 bg-muted-foreground rounded-full mt-1.5 mr-3 flex-shrink-0"></span>
              You cannot vote on ongoing disputes
            </li>
          </ul>
        </div>

        <div className="mt-6 text-sm text-muted-foreground">
          <p>If you believe this is an error, please contact support or check your feature flag configuration.</p>
        </div>
      </div>
    </div>
  );
}
