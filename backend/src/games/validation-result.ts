import { Metadata } from "../domain";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  message: string;
  severity: ValidationSeverity;
  path?: string;
  metadata?: Metadata;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validationPassed(warnings: ValidationIssue[] = []): ValidationResult {
  return {
    valid: true,
    errors: [],
    warnings
  };
}

export function validationFailed(
  errors: ValidationIssue[],
  warnings: ValidationIssue[] = []
): ValidationResult {
  return {
    valid: false,
    errors,
    warnings
  };
}
