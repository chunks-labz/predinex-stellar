/**
 * Enhanced Market Card with improved UX
 * Issue #1533: Iteration 3
 */

import React from 'react';
import { ProgressBar } from './ui/ProgressBar';

export const EnhancedMarketCard: React.FC<any> = ({ pool }) => {
  const totalVolume = pool.total_a + pool.total_b;
  const percentageA = totalVolume ? (pool.total_a / totalVolume) * 100 : 50;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-xl transition-all p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">{pool.title}</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{pool.description}</p>
      
      <div className="space-y-3">
        <ProgressBar
          value={pool.total_a}
          max={totalVolume}
          label={pool.outcome_a_name}
          showPercentage
          color="bg-green-500"
        />
        <ProgressBar
          value={pool.total_b}
          max={totalVolume}
          label={pool.outcome_b_name}
          showPercentage
          color="bg-red-500"
        />
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">Total Volume</span>
        <span className="font-semibold text-gray-900 dark:text-white">{totalVolume} XLM</span>
      </div>
    </div>
  );
};

export default EnhancedMarketCard;
