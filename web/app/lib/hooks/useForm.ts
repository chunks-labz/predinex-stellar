/**
 * Custom hook for form handling
 * Provides form state management and validation
 */

import { useState, useCallback } from 'react';

interface FormErrors {
  [key: string]: string;
}

interface UseFormOptions<T> {
  initialValues: T;
  onSubmit: (values: T) => Promise<void> | void;
  validate?: (values: T) => FormErrors;
}

/**
 * Hook for managing form state and validation
 * @param options Form configuration
 * @returns Form state and handlers
 */
export function useForm<T extends Record<string, unknown>>({
  initialValues,
  onSubmit,
  validate,
}: UseFormOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { name, value, type } = e.target;

      setValues(prev => ({
        ...prev,
        [name]: type === 'number' ? parseFloat(value) : value,
      }));

      // Clear error when user starts typing
      if (errors[name]) {
        setErrors(prev => ({
          ...prev,
          [name]: '',
        }));
      }
    },
    [errors]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { name } = e.target;

      setTouched(prev => ({
        ...prev,
        [name]: true,
      }));

      // Validate field on blur
      if (validate) {
        const fieldErrors = validate(values);
        if (fieldErrors[name]) {
          setErrors(prev => ({
            ...prev,
            [name]: fieldErrors[name],
          }));
        }
      }
    },
    [values, validate]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      // Validate all fields
      if (validate) {
        const newErrors = validate(values);
        setErrors(newErrors);

        if (Object.keys(newErrors).length > 0) {
          return;
        }
      }

      setIsSubmitting(true);

      try {
        await onSubmit(values);
      } catch (error) {
        log.error('Form submission error:', error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, validate, onSubmit]
  );

  const resetForm = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
  }, [initialValues]);

  const setFieldValue = useCallback((name: string, value: unknown) => {
    setValues(prev => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const setFieldError = useCallback((name: string, error: string) => {
    setErrors(prev => ({
      ...prev,
      [name]: error,
    }));
  }, []);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    resetForm,
    setFieldValue,
    setFieldError,
  };
}

/**
 * Hook for managing a single form field
 * @param initialValue Initial field value
 * @param validate Validation function
 * @returns Field state and handlers
 */
export function useField(
  initialValue: unknown = '',
  validate?: (value: unknown) => string | undefined
) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | undefined>();
  const [touched, setTouched] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      // Clear error when user starts typing
      if (error) {
        setError(undefined);
      }
    },
    [error]
  );

  const handleBlur = useCallback(() => {
    setTouched(true);

    if (validate) {
      const validationError = validate(value);
      setError(validationError);
    }
  }, [value, validate]);

  const reset = useCallback(() => {
    setValue(initialValue);
    setError(undefined);
    setTouched(false);
  }, [initialValue]);

  return {
    value,
    error,
    touched,
    setValue,
    setError,
    handleChange,
    handleBlur,
    reset,
  };
}
