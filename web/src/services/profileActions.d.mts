export type ProfileActionOption = {
  kind: 'home' | 'service';
  id: string;
  label: string;
  category: string;
  reason: string;
};

export type ProfileActionService = {
  id: string;
  name?: string | null;
  category?: string | null;
};

export type ProfileActionProfessional = {
  categories?: readonly string[] | null;
  home_services?: readonly string[] | null;
  service_packages?: readonly ProfileActionService[] | null;
};

export function profileActionOptions(
  professional: ProfileActionProfessional | null | undefined,
  options?: {category?: string | null; services?: readonly ProfileActionService[] | null},
): ProfileActionOption[];

export function profileHireLabel(
  professional: ProfileActionProfessional | null | undefined,
  category?: string | null,
): string;
