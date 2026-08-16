import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "./repository-result";
import {
  UploadReport,
  UploadReportId,
  UploadReportRepository
} from "./upload-report-repository";

export class InMemoryUploadReportRepository
  implements UploadReportRepository
{
  private readonly reports = new Map<UploadReportId, UploadReport>();

  async create(report: UploadReport): Promise<RepositoryResult<UploadReport>> {
    if (this.reports.has(report.id)) {
      return repositoryFailure({
        code: "conflict",
        message: `Upload report "${report.id}" already exists.`
      });
    }

    this.reports.set(report.id, report);
    return repositorySuccess(report);
  }

  async update(report: UploadReport): Promise<RepositoryResult<UploadReport>> {
    if (!this.reports.has(report.id)) {
      return repositoryFailure({
        code: "not_found",
        message: `Upload report "${report.id}" was not found.`
      });
    }

    this.reports.set(report.id, report);
    return repositorySuccess(report);
  }

  async findById(
    id: UploadReportId
  ): Promise<RepositoryResult<UploadReport | null>> {
    return repositorySuccess(this.reports.get(id) ?? null);
  }
}
