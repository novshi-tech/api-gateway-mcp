# ビルメンNEXT GraphQL リファレンス

自動生成: `tools/gen-bm-next-reference.py`(元: https://api.bm-next.ai/graphql/schema.graphql)。
見出しは `## query <名前>`、`## mutation <名前>`、`## type <名前>`、`## input <名前>`、`## enum <名前>` の形。`grep -n '^## query works' references/schema.md` のように検索して、その節だけ読む。
一覧の結果は `{ results, continuationToken }` の形。次のページは `continuationToken` を `from` に渡す。

## query impersonationSessions

```graphql
impersonationSessions(organizationId: String actorMemberId: String actorOrganizationId: String includeEnded: Boolean): [ImpersonationSession!]!
```

必要な権限: System 組織の管理者のみ

## query currentImpersonationSession

```graphql
currentImpersonationSession: ImpersonationSession
```

必要な権限: 要認証

## query roles

```graphql
roles: [Role!]!
```

必要な権限: 組織に所属していること、スコープ `platform.role.read`

## query myAssignableRoles

```graphql
myAssignableRoles: [Role!]!
```

必要な権限: 組織に所属していること、スコープ `platform.member.role.assign`

## query role

```graphql
role(roleId: String!): Role!
```

必要な権限: 組織に所属していること、スコープ `platform.role.read`

## query featureFlags

```graphql
featureFlags: [FeatureFlag!]!
```

必要な権限: 組織に所属していること、スコープ `platform.feature-flag.read`

## query featureFlag

```graphql
featureFlag(featureFlagId: String!): FeatureFlag!
```

必要な権限: 組織に所属していること、スコープ `platform.feature-flag.read`

## query memberRoles

```graphql
memberRoles(memberId: String!): [MemberRole!]!
```

必要な権限: 組織に所属していること、スコープ `platform.member.read`

## query scopeMetadata

```graphql
scopeMetadata: [ScopeMetadata!]!
```

必要な権限: System 組織の管理者のみ

## query featureMetadata

```graphql
featureMetadata: [FeatureMetadata!]!
```

必要な権限: System 組織の管理者のみ

## query billingAccount

```graphql
billingAccount: BillingAccount
```

必要な権限: 要認証、スコープ `platform.billing.read`

## query subscriptions

```graphql
subscriptions: [Subscription!]!
```

必要な権限: 要認証、スコープ `platform.billing.read`

## query billingTerms

```graphql
billingTerms(productCode: ProductCode!): BillingTerms!
```

必要な権限: 要認証、スコープ `platform.billing.read`

## query licenseGrants

```graphql
licenseGrants(organizationId: String!): [LicenseGrant!]!
```

必要な権限: System 組織の管理者のみ

## query session

```graphql
session: Session
```

## query myOrganization

```graphql
myOrganization: Organization!
```

必要な権限: 組織に所属していること

## query myScopes

```graphql
myScopes: [String!]!
```

必要な権限: 要認証

## query myFeatureFlags

```graphql
myFeatureFlags: [String!]!
```

必要な権限: 要認証

## query myEntitlements

```graphql
myEntitlements: [ProductEntitlement!]!
```

必要な権限: 組織に所属していること

## query magicLinks

```graphql
magicLinks(memberId: String from: String count: Int): QueryResultOfMagicLink!
```

必要な権限: 要認証、スコープ `platform.magic-link.read`

## query myApiKeys

```graphql
myApiKeys(from: String count: Int): QueryResultOfApiKey!
```

必要な権限: 組織に所属していること、スコープ `platform.api-key.read`

## query members

```graphql
members(name: String from: String limit: Int): QueryResultOfMember!
```

必要な権限: 要認証、スコープ `platform.member.read`

## query member

```graphql
member(id: String!): Member!
```

必要な権限: 要認証、スコープ `platform.member.read`

## query organizations

```graphql
organizations(search: String kind: OrganizationKind from: String first: Int): QueryResultOfOrganization!
```

必要な権限: System 組織の管理者のみ

## query organizationLinks

```graphql
organizationLinks: [OrganizationLink!]!
```

必要な権限: 組織に所属していること、スコープ `works.partner-link.read`

## query organizationLinkInvitation

```graphql
organizationLinkInvitation(token: String!): OrganizationLinkInvitation
```

必要な権限: 組織に所属していること、スコープ `works.partner-link.read`

## query savedWorkFilters

```graphql
savedWorkFilters(target: SavedWorkFilterTarget!): [SavedWorkFilter!]!
```

必要な権限: 要認証、組織に所属していること

## query absences

```graphql
absences(from: String count: Int): QueryResultOfAbsence!
```

必要な権限: 要認証、スコープ `works.absence.read`

## query absencesByMonth

```graphql
absencesByMonth(year: Int! month: Int! memberId: String from: String count: Int): QueryResultOfAbsence!
```

必要な権限: 要認証、スコープ `works.absence.read`

## query partners

```graphql
partners(name: String from: String limit: Int): QueryResultOfPartner!
```

必要な権限: 要認証、スコープ `works.partner.read`

## query workTagKeys

```graphql
workTagKeys(includeRetired: Boolean): QueryResultOfWorkTagKey!
```

必要な権限: 要認証、スコープ `works.work-tag-key.read`

## query workTagKey

```graphql
workTagKey(id: String!): WorkTagKey!
```

必要な権限: 要認証、スコープ `works.work-tag-key.read`

## query works

```graphql
works(name: String frequencies: [ScheduleFrequency!] statuses: [GenericEntityStatus!] tagValues: [WorkTagValueInput!]): QueryResultOfWork!
```

必要な権限: 要認証、スコープ `works.work.read`

## query work

```graphql
work(id: String!): Work!
```

必要な権限: 要認証、スコープ `works.work.read`

## query executionMonths

```graphql
executionMonths: [ExecutionMonth!]!
```

必要な権限: 要認証、スコープ `works.execution-month.read`

## query executionMonth

```graphql
executionMonth(year: Int! month: Int!): ExecutionMonth
```

必要な権限: 要認証、スコープ `works.execution-month.read`

## query monthlyWorkStatuses

```graphql
monthlyWorkStatuses(year: Int! month: Int! showWithoutTodo: Boolean from: String count: Int): QueryResultOfMonthlyWorkStatus!
```

必要な権限: 要認証、スコープ `works.work.read`

## query monthlyWorkStatus

```graphql
monthlyWorkStatus(id: String!): MonthlyWorkStatus!
```

必要な権限: 要認証、スコープ `works.work.read`

## query assignment

```graphql
assignment(id: String!): Assignment!
```

必要な権限: 要認証、スコープ `works.assignment.read`

## query assignments

```graphql
assignments(assignmentFrameIds: [String!] workId: String worker: WorkerRefInput from: String limit: Int): QueryResultOfAssignment!
```

必要な権限: 要認証、スコープ `works.assignment.read`

## query worker

```graphql
worker(workerId: String! workerType: WorkerType!): IWorker
```

必要な権限: 要認証、スコープ `works.work.read`

## query workQuotaUsage

```graphql
workQuotaUsage: WorkQuotaUsage!
```

必要な権限: 要認証、スコープ `works.work.read`

## query nationalHolidays

```graphql
nationalHolidays(year: Int!): [NationalHoliday!]!
```

必要な権限: 要認証、スコープ `works.work.read`

## query workSubmissions

```graphql
workSubmissions(partnerId: String! yearMonth: YearMonthInput!): WorkSubmissionsPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.submission.read`

## query facilityReportTemplate

```graphql
facilityReportTemplate(facilityId: String!): FacilityReportTemplate
```

必要な権限: 要認証、スコープ `meter-reading.report.template.read`、機能フラグ `meter-reading.report.custom-template`

## query facilities

```graphql
facilities(status: GenericEntityStatus from: String limit: Int): QueryResultOfFacility!
```

必要な権限: 要認証、スコープ `meter-reading.facility.read`

## query facility

```graphql
facility(facilityId: String!): Facility
```

必要な権限: 要認証、スコープ `meter-reading.facility.read`

## query meters

```graphql
meters(facilityId: String! yearMonth: String! status: GenericEntityStatus from: String limit: Int): QueryResultOfMeter!
```

必要な権限: 要認証、スコープ `meter-reading.meter.read`

## query meterChanges

```graphql
meterChanges(sinceTs: Long! from: String limit: Int): QueryResultOfMeter!
```

必要な権限: 要認証、スコープ `meter-reading.meter.read`

## query facilityChanges

```graphql
facilityChanges(sinceTs: Long! from: String limit: Int): QueryResultOfFacility!
```

必要な権限: 要認証、スコープ `meter-reading.facility.read`

## query meterQuotaUsage

```graphql
meterQuotaUsage(meterMonth: String!): MeterQuotaUsage!
```

必要な権限: 要認証、スコープ `meter-reading.meter.read`

## query isMonthInitialized

```graphql
isMonthInitialized(facilityId: String! yearMonth: String!): Boolean!
```

必要な権限: 要認証、スコープ `meter-reading.meter.read`

## mutation createRole

```graphql
createRole(input: CreateRoleInput!): RolePayload!
```

必要な権限: 組織に所属していること、スコープ `platform.role.write`

## mutation updateRole

```graphql
updateRole(input: UpdateRoleInput!): RolePayload!
```

必要な権限: 組織に所属していること、スコープ `platform.role.write`

## mutation deleteRole

```graphql
deleteRole(roleId: String!): DeleteRolePayload!
```

必要な権限: 組織に所属していること、スコープ `platform.role.write`

## mutation assignRoleToMember

```graphql
assignRoleToMember(input: AssignRoleToMemberInput!): AssignRolePayload!
```

必要な権限: 組織に所属していること、スコープ `platform.member.role.assign`

## mutation removeRoleFromMember

```graphql
removeRoleFromMember(input: RemoveRoleFromMemberInput!): RemoveRolePayload!
```

必要な権限: 組織に所属していること、スコープ `platform.member.role.assign`

## mutation createFeatureFlag

```graphql
createFeatureFlag(input: CreateFeatureFlagInput!): FeatureFlagPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.feature-flag.write`

## mutation updateFeatureFlag

```graphql
updateFeatureFlag(input: UpdateFeatureFlagInput!): FeatureFlagPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.feature-flag.write`

## mutation deleteFeatureFlag

```graphql
deleteFeatureFlag(featureFlagId: String!): DeleteFeatureFlagPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.feature-flag.write`

## mutation createApiKey

```graphql
createApiKey(input: CreateApiKeyInput!): CreateApiKeyPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.api-key.write`

## mutation revokeApiKey

```graphql
revokeApiKey(input: RevokeApiKeyInput!): RevokeApiKeyPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.api-key.write`

## mutation removeSession

```graphql
removeSession: RemoveSessionPayload!
```

## mutation createMagicLink

```graphql
createMagicLink(input: CreateMagicLinkInput!): CreateMagicLinkPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.magic-link.write`

## mutation deleteMagicLink

```graphql
deleteMagicLink(input: DeleteMagicLinkInput!): DeleteMagicLinkPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.magic-link.write`

## mutation requestNewPasskey

```graphql
requestNewPasskey: NewPasskeyRequest!
```

必要な権限: 組織に所属していること

## mutation deleteIdentifier

```graphql
deleteIdentifier(identifierId: String!): DeleteIdentifierPayload!
```

必要な権限: 組織に所属していること

## mutation createCheckoutSession

```graphql
createCheckoutSession(input: CheckoutSessionInput!): CreateCheckoutSessionPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.billing.manage`

## mutation createCustomerPortalSession

```graphql
createCustomerPortalSession(input: CustomerPortalSessionInput!): CreateCustomerPortalSessionPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.billing.manage`

## mutation startOrganizationImpersonation

```graphql
startOrganizationImpersonation(input: StartOrganizationImpersonationInput!): StartImpersonationPayload!
```

必要な権限: System 組織の管理者のみ

## mutation endOrganizationImpersonation

```graphql
endOrganizationImpersonation: EndImpersonationPayload!
```

必要な権限: 要認証

## mutation grantLifetimeLicense

```graphql
grantLifetimeLicense(input: GrantLifetimeLicenseRequestInput!): LicenseGrant!
```

必要な権限: System 組織の管理者のみ

## mutation revokeLifetimeLicense

```graphql
revokeLifetimeLicense(input: RevokeLifetimeLicenseRequestInput!): Boolean!
```

必要な権限: System 組織の管理者のみ

## mutation createMember

```graphql
createMember(input: CreateMemberInput!): MemberPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.member.write`

## mutation updateMember

```graphql
updateMember(input: UpdateMemberInput!): MemberPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.member.write`

## mutation updateMemberStatus

```graphql
updateMemberStatus(input: UpdateMemberStatusInput!): UpdateMemberStatusPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.member.write`

## mutation deleteMember

```graphql
deleteMember(input: DeleteMemberInput!): DeleteMemberPayload!
```

必要な権限: 組織に所属していること、スコープ `platform.member.write`

## mutation inviteOrganizationLink

```graphql
inviteOrganizationLink(input: InviteOrganizationLinkInput!): OrganizationLinkPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.partner-link.write`

## mutation acceptOrganizationLink

```graphql
acceptOrganizationLink(input: AcceptOrganizationLinkInput!): AcceptOrganizationLinkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.partner-link.write`

## mutation revokeOrganizationLink

```graphql
revokeOrganizationLink(input: RevokeOrganizationLinkInput!): OrganizationLinkPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.partner-link.write`

## mutation createPartner

```graphql
createPartner(input: CreatePartnerInput!): PartnerPayload!
```

必要な権限: 組織に所属していること、スコープ `works.partner.write`

## mutation updatePartner

```graphql
updatePartner(input: UpdatePartnerInput!): PartnerPayload!
```

必要な権限: 組織に所属していること、スコープ `works.partner.write`

## mutation updatePartnerStatus

```graphql
updatePartnerStatus(input: UpdatePartnerStatusInput!): UpdatePartnerStatusPayload!
```

必要な権限: 組織に所属していること、スコープ `works.partner.write`

## mutation deletePartner

```graphql
deletePartner(input: DeletePartnerInput!): DeletePartnerPayload!
```

必要な権限: 組織に所属していること、スコープ `works.partner.write`

## mutation createSavedWorkFilter

```graphql
createSavedWorkFilter(input: CreateSavedWorkFilterInput!): SavedWorkFilterPayload!
```

必要な権限: 組織に所属していること、スコープ `works.saved-filter.write`

## mutation updateSavedWorkFilter

```graphql
updateSavedWorkFilter(input: UpdateSavedWorkFilterInput!): SavedWorkFilterPayload!
```

必要な権限: 組織に所属していること、スコープ `works.saved-filter.write`

## mutation deleteSavedWorkFilter

```graphql
deleteSavedWorkFilter(id: String!): SavedWorkFilterPayload!
```

必要な権限: 組織に所属していること、スコープ `works.saved-filter.write`

## mutation uploadScheduleReportTemplate

```graphql
uploadScheduleReportTemplate(input: UploadScheduleReportTemplateInput!): ScheduleReportTemplatePayload!
```

必要な権限: 組織に所属していること、スコープ `works.report.template.write`、機能フラグ `works.report.custom-template`

## mutation deleteScheduleReportTemplate

```graphql
deleteScheduleReportTemplate(savedFilterId: String!): DeleteScheduleReportTemplatePayload!
```

必要な権限: 組織に所属していること、スコープ `works.report.template.write`、機能フラグ `works.report.custom-template`

## mutation createWork

```graphql
createWork(input: CreateWorkInput!): WorkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation updateWork

```graphql
updateWork(input: UpdateWorkInput!): WorkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation updateWorkStatus

```graphql
updateWorkStatus(input: UpdateWorkStatusInput!): WorkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation deleteWork

```graphql
deleteWork(input: DeleteWorkInput!): WorkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation createAssignmentFrame

```graphql
createAssignmentFrame(input: CreateAssignmentFrameInput!): WorkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation updateAssignmentFrame

```graphql
updateAssignmentFrame(input: UpdateAssignmentFrameInput!): WorkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation deleteAssignmentFrame

```graphql
deleteAssignmentFrame(input: DeleteAssignmentFrameInput!): WorkPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation createAssignment

```graphql
createAssignment(input: CreateAssignmentInput!): AssignmentPayload!
```

必要な権限: 組織に所属していること、スコープ `works.assignment.write`

## mutation updateAssignment

```graphql
updateAssignment(input: UpdateAssignmentInput!): AssignmentPayload!
```

必要な権限: 組織に所属していること、スコープ `works.assignment.write`

## mutation deleteAssignment

```graphql
deleteAssignment(input: DeleteAssignmentInput!): AssignmentPayload!
```

必要な権限: 組織に所属していること、スコープ `works.assignment.write`

## mutation createScheduleAdjustment

```graphql
createScheduleAdjustment(input: CreateAdjustmentInput!): CreateAdjustmentPayload!
```

必要な権限: 組織に所属していること、スコープ `works.schedule.adjust`

## mutation updateScheduleAdjustment

```graphql
updateScheduleAdjustment(input: UpdateAdjustmentInput!): UpdateAdjustmentPayload!
```

必要な権限: 組織に所属していること、スコープ `works.schedule.adjust`

## mutation deleteScheduleAdjustment

```graphql
deleteScheduleAdjustment(input: DeleteAdjustmentInput!): DeleteAdjustmentPayload!
```

必要な権限: 組織に所属していること、スコープ `works.schedule.adjust`

## mutation registerAbsence

```graphql
registerAbsence(input: RegisterAbsenceInput!): RegisterAbsencePayload!
```

必要な権限: 組織に所属していること、スコープ `works.absence.write`

## mutation updateAbsence

```graphql
updateAbsence(input: UpdateAbsenceInput!): UpdateAbsencePayload!
```

必要な権限: 組織に所属していること、スコープ `works.absence.write`

## mutation cancelAbsence

```graphql
cancelAbsence(input: CancelAbsenceInput!): CancelAbsencePayload!
```

必要な権限: 組織に所属していること、スコープ `works.absence.write`

## mutation createExecutionMonth

```graphql
createExecutionMonth(input: CreateExecutionMonthInput!): CreateExecutionMonthPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation deleteExecutionMonth

```graphql
deleteExecutionMonth(input: DeleteExecutionMonthInput!): DeleteExecutionMonthPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation registerNationalHolidays

```graphql
registerNationalHolidays(input: RegisterNationalHolidaysInput!): RegisterNationalHolidaysPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation unregisterNationalHolidays

```graphql
unregisterNationalHolidays(input: UnregisterNationalHolidaysInput!): UnregisterNationalHolidaysPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work.write`

## mutation adjustReceivedSchedule

```graphql
adjustReceivedSchedule(input: AdjustReceivedScheduleInput!): AdjustReceivedSchedulePayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.schedule.adjust`

## mutation submitWorkMonth

```graphql
submitWorkMonth(input: SubmitWorkMonthInput!): SubmitWorkMonthPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.submission.write`

## mutation withdrawWorkSubmission

```graphql
withdrawWorkSubmission(input: WithdrawWorkSubmissionInput!): WithdrawWorkSubmissionPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.submission.write`

## mutation markWorkSubmissionsRead

```graphql
markWorkSubmissionsRead(input: MarkWorkSubmissionsReadInput!): MarkWorkSubmissionsReadPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.submission.read`

## mutation shareWorkDefinition

```graphql
shareWorkDefinition(input: ShareWorkDefinitionInput!): ShareWorkDefinitionPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.submission.write`

## mutation resharePartnerWorkDefinitions

```graphql
resharePartnerWorkDefinitions(input: ResharePartnerWorkDefinitionsInput!): ResharePartnerWorkDefinitionsPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.work.write`

## mutation detachWork

```graphql
detachWork(input: DetachWorkInput!): WorkPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.work.write`

## mutation setWorkClientPartner

```graphql
setWorkClientPartner(input: SetWorkClientPartnerInput!): WorkPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.work.write`

## mutation setWorkContractorPartner

```graphql
setWorkContractorPartner(input: SetWorkContractorPartnerInput!): WorkPayload!
```

必要な権限: 組織に所属していること、機能フラグ `works.sharing`、スコープ `works.work.write`

## mutation createWorkTagKey

```graphql
createWorkTagKey(input: CreateWorkTagKeyInput!): WorkTagKeyPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work-tag-key.write`

## mutation updateWorkTagKey

```graphql
updateWorkTagKey(input: UpdateWorkTagKeyInput!): WorkTagKeyPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work-tag-key.write`

## mutation retireWorkTagKey

```graphql
retireWorkTagKey(input: RetireWorkTagKeyInput!): WorkTagKeyPayload!
```

必要な権限: 組織に所属していること、スコープ `works.work-tag-key.write`

## mutation uploadFacilityReportTemplate

```graphql
uploadFacilityReportTemplate(input: UploadFacilityReportTemplateInput!): FacilityReportTemplatePayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.report.template.write`、機能フラグ `meter-reading.report.custom-template`

## mutation deleteFacilityReportTemplate

```graphql
deleteFacilityReportTemplate(facilityId: String!): DeleteFacilityReportTemplatePayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.report.template.write`、機能フラグ `meter-reading.report.custom-template`

## mutation createFacility

```graphql
createFacility(input: CreateFacilityInput!): FacilityPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.facility.write`

## mutation updateFacility

```graphql
updateFacility(input: UpdateFacilityInput!): FacilityPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.facility.write`

## mutation archiveFacility

```graphql
archiveFacility(input: ArchiveFacilityInput!): FacilityPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.facility.write`

## mutation unarchiveFacility

```graphql
unarchiveFacility(input: UnarchiveFacilityInput!): FacilityPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.facility.write`

## mutation createMeter

```graphql
createMeter(input: CreateMeterInput!): MeterPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.meter.write`

## mutation updateMeter

```graphql
updateMeter(input: UpdateMeterInput!): MeterPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.meter.write`

## mutation archiveMeter

```graphql
archiveMeter(input: ArchiveMeterInput!): MeterPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.meter.write`

## mutation recordMeterValue

```graphql
recordMeterValue(input: RecordMeterValueInput!): MeterPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.reading.write`

## mutation clearMeterValue

```graphql
clearMeterValue(input: ClearMeterValueInput!): MeterPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.reading.write`

## mutation initializeMonth

```graphql
initializeMonth(input: InitializeMonthInput!): InitializeMonthPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.reading.write`

## mutation createShareLink

```graphql
createShareLink(input: CreateShareLinkInput!): MeterReportSharePayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.report.share`

## mutation uploadPhoto

```graphql
uploadPhoto(input: UploadPhotoInput!): PhotoPayload!
```

必要な権限: 組織に所属していること、スコープ `meter-reading.reading.write`

## interface Identifier

```graphql
type: IdentifierType!
value: String!
id: String!
name: String!
createdAt: DateTime!
lastUsedAt: DateTime!
partitionKey: String!
member: MemberReference!
```

## type Absence

```graphql
partitionKey: String!
delete: Absence!
id: String!
memberId: String!
organizationId: String!
date: LocalDate!
timeFrame: TimeFrame!
deleted: Boolean!
hasErrors: Boolean!
errors: [ValidationError!]!
member: Member
```

## type AcceptOrganizationLinkPayload

```graphql
result: AcceptOrganizationLinkResult!
link: OrganizationLink
partner: Partner
```

## type AdjustReceivedSchedulePayload

```graphql
adjustment: ExecutionScheduleAdjustment!
```

## type ApiKey

```graphql
partitionKey: String!
id: String!
member: MemberReference!
name: String!
createdAt: DateTime!
revokedAt: DateTime
isRevoked: Boolean!
```

## type AssignRolePayload

```graphql
memberRole: MemberRole!
```

## type Assignment

```graphql
id: String!
workId: String!
assignmentFrameId: String!
scheduleConstraint: ScheduleConstraint!
hasErrors: Boolean!
errors: [ValidationError!]!
creatorMemberId: String!
worker: IWorker!
work: Work!
assignmentFrame: AssignmentFrame!
```

## type AssignmentFrame

```graphql
id: String!
name: String!
minimumRequiredPersonMinutesByExecution: Int!
minimumRequiredWorkersByExecution: Int!
scheduledPersonMinutes: Int!
effectiveFrom: LocalDate
effectiveUntil: LocalDate
assignments(year: Int! month: Int!): QueryResultOfAssignment!
```

## type AssignmentPayload

```graphql
assignment: Assignment!
```

## type BillingAccount

```graphql
id: String!
organizationId: String!
stripeCustomerId: String!
```

## type BillingTerms

```graphql
trialPeriodDays: Int
setupFee: SetupFeeTerms
```

## type ByYearsConstraint

```graphql
interval: Int!
startYear: Int!
```

## type CancelAbsencePayload

```graphql
id: String!
```

## type CreateAdjustmentPayload

```graphql
adjustment: ExecutionScheduleAdjustment!
```

## type CreateApiKeyPayload

```graphql
apiKey: ApiKey!
rawKey: String!
```

## type CreateCheckoutSessionPayload

```graphql
sessionUrl: String!
```

## type CreateCustomerPortalSessionPayload

```graphql
sessionUrl: String!
```

## type CreateExecutionMonthPayload

```graphql
month: ExecutionMonth!
```

## type CreateMagicLinkPayload

```graphql
url: String!
```

## type CreateOrganizationPayload

```graphql
result: CreateOrganizationResult!
organization: Organization
```

## type DayOfWeekSpec

```graphql
dayOfWeek: DayOfWeek!
occurrence: Int
```

## type DeleteAdjustmentPayload

```graphql
id: String!
```

## type DeleteExecutionMonthPayload

```graphql
yearMonth: YearMonth!
```

## type DeleteFacilityReportTemplatePayload

```graphql
success: Boolean!
```

## type DeleteFeatureFlagPayload

```graphql
featureFlagId: String!
```

## type DeleteIdentifierPayload

```graphql
success: Boolean!
```

## type DeleteMagicLinkPayload

```graphql
magicLink: MagicLink!
```

## type DeleteMemberPayload

```graphql
member: Member!
```

## type DeletePartnerPayload

```graphql
partner: Partner!
```

## type DeleteRolePayload

```graphql
roleId: String!
```

## type DeleteScheduleReportTemplatePayload

```graphql
success: Boolean!
```

## type EmailIdentifier

```graphql
email: String!
partitionKey: String!
type: IdentifierType!
value: String!
name: String!
member: MemberReference!
createdAt: DateTime!
lastUsedAt: DateTime!
id: String!
```

## type EndImpersonationPayload

```graphql
result: EndImpersonationResult!
impersonationSession: ImpersonationSession
restoredSession: Session
```

## type ExecutionAbsence

```graphql
absenceId: String!
date: LocalDate!
timeFrame: TimeFrame!
worker: IWorker!
```

## type ExecutionAssignment

```graphql
id: String!
assignmentId: String!
timeFrames: [TimeFrame!]!
effectivePersonMinutes: Int!
worker: IWorker!
```

## type ExecutionAssignmentFrame

```graphql
id: String!
allowFloatingTimeFrame: Boolean!
assignmentFrameId: String!
name: String!
minimumRequiredPersonMinutesByExecution: Int!
minimumRequiredWorkersByExecution: Int!
assignments: [ExecutionAssignment!]!
absentAssignments: [ExecutionAbsence!]!
assignedPersonMinutes: Int!
isFixed: Boolean!
isFulfilled: Boolean!
isRequiredPersonMinutesFullFilled: Boolean!
requiredTimeFrames: [TimeFrame!]!
requiredPersonMinutes: Int!
allowFloatingAssignments: Boolean!
timeFrames: [ExecutionTimeFrame!]!
isRequiredWorkersFullFilled: Boolean!
todos: [TodoItem!]!
```

## type ExecutionMonth

```graphql
id: String!
yearMonth: YearMonth!
status: ExecutionMonthStatus!
monthlyWorkStatuses(showWithoutTodo: Boolean workIds: [String!] from: String count: Int): QueryResultOfMonthlyWorkStatus!
monthlyWorkStatus(workId: String!): MonthlyWorkStatus!
executionSchedules(workerIds: [String!] workIds: [String!] workName: String isFixed: Boolean isFulfilled: Boolean frequencies: [ScheduleFrequency!] tagValues: [WorkTagValueInput!] limit: Int day: Int): [ExecutionSchedule!]!
executionSchedule(scheduleId: String!): ExecutionSchedule
```

## type ExecutionSchedule

```graphql
id: String!
workId: String!
occurrenceIndex: Int
isFromActiveSubmission: Boolean!
adjustment: ExecutionScheduleAdjustment
title: String!
requiredSchedule: Schedule!
adjustedSchedule: Schedule!
assignmentFrames: [ExecutionAssignmentFrame!]!
allowFloatingTimeFrame: Boolean!
origin: ExecutionOrigin!
isProvisional: Boolean!
isOverridden: Boolean!
isFixed: Boolean!
assignmentStatus: AssignmentFulfillmentStatus!
isFulfilled: Boolean!
todos: [TodoItem!]!
hasTodos: Boolean!
work: Work
```

## type ExecutionScheduleAdjustment

```graphql
id: String!
createdAt: DateTime!
organizationId: String!
requiredSchedule: Schedule!
adjustedSchedule: Schedule!
kind: ExecutionScheduleAdjustmentKind
occurrenceIndex: Int
```

## type ExecutionTimeFrame

```graphql
timeFrame: TimeFrame!
assignmentIds: [String!]!
assignedWorkers: Int!
assignedPersonMinutes: Int!
```

## type Facility

```graphql
id: String!
name: String!
nameReading: String
status: GenericEntityStatus!
lastReadingMonth: String
updatedAt: DateTime
```

## type FacilityPayload

```graphql
facility: Facility
```

## type FacilityReportTemplate

```graphql
id: String!
facilityId: String!
blobPath: String!
originalFileName: String!
uploadedAt: DateTime!
status: FacilityReportTemplateStatus!
updatedAt: DateTime
```

## type FacilityReportTemplatePayload

```graphql
template: FacilityReportTemplate!
```

## type FeatureFlag

```graphql
partitionKey: String!
isAllowedFor(organizationId: String! roleIds: [String!]!): Boolean!
id: String!
key: String!
description: String!
isEnabled: Boolean!
enabledOrganizationIds: [String!]!
enabledRoleIds: [String!]!
createdAt: DateTime!
```

## type FeatureFlagPayload

```graphql
featureFlag: FeatureFlag!
```

## type FeatureMetadata

```graphql
key: String!
description: String!
```

## type IdentifierRequirement

```graphql
type: IdentifierType!
priority: IdentifierRequirementPriority!
```

## type ImpersonationSession

```graphql
id: String!
actorMemberId: String!
actorOrganizationId: String!
targetOrganizationId: String!
startedAt: DateTime!
endedAt: DateTime
endReason: ImpersonationEndReason
```

## type InitializeMonthPayload

```graphql
initializedCount: Int!
```

## type InitiateOtpSignInPayload

```graphql
id: String
expiration: DateTime
status: InitiateOtpSignInStatus!
```

## type InitiatePasskeySignInPayload

```graphql
challengeId: UUID!  # Unique identifier for the passkey sign-in challenge
assertionOptions: String!  # JSON-serialized WebAuthn assertion options for the client
```

## type LicenseGrant

```graphql
id: String!
organizationId: String!
productCode: ProductCode!
grantedAt: DateTime!
grantedByMemberId: String!
note: String
```

## type MagicLink

```graphql
partitionKey: String!
id: String!
url: String!
member: MemberReference!
accountRequirements: AccountRequirements!
createdAt: DateTime!
expiresInMinutes: Int!
expiresAt: DateTime!
isExpired: Boolean!
```

## type MarkWorkSubmissionsReadPayload

```graphql
markedCount: Int!
```

## type Member

```graphql
id: String!
name: String!
managementNo: String
status: GenericEntityStatus!
identifiers: [Identifier!]!
```

## type MemberPayload

```graphql
member: Member!
```

## type MemberReference

```graphql
organizationId: String!
memberId: String!
id: String!
partitionKey: String!
```

## type MemberRole

```graphql
partitionKey: String!
id: String!
memberId: String!
organizationId: String!
roleId: String!
assignedAt: DateTime!
```

## type Meter

```graphql
id: String!
facilityId: String!
meterMonth: String!
meterName: String!
nameReading: String
meterKey: String
displayOrder: Int
meterNo: String
measureDate: String
measureValue: Float
measureValueDecimalDigits: Int
meterPhotoUrl: String
previousMeterDate: String
previousMeterValue: Float
previousMeterValueDecimalDigits: Int
previousUsedAmount: Float
usedAmount: Float
medianUsedAmount: Float
status: GenericEntityStatus!
updatedAt: DateTime
```

## type MeterPayload

```graphql
meter: Meter!
```

## type MeterQuotaUsage

```graphql
quantity: Int!
currentCount: Int!
limit: Int!
exceeded: Boolean!
isUnlimited: Boolean!
```

## type MeterReportShare

```graphql
id: String!
facilityId: String!
meterMonth: String!
expiresAt: DateTime!
```

## type MeterReportSharePayload

```graphql
share: MeterReportShare!
```

## type MonthlyWorkStatus

```graphql
id: String!
work: Work!
yearMonth: YearMonth!
name: String!
assignments: [Assignment!]!
submission: MonthlyWorkSubmission
executionSchedules: [ExecutionSchedule!]!
isFixed: Boolean!
assignmentStatus: AssignmentFulfillmentStatus!
isFulfilled: Boolean!
etag: String
todos: [TodoItem!]!
hasTodos: Boolean!
executionSchedule(day: Int): ExecutionSchedule!
```

## type MonthlyWorkSubmission

```graphql
version: Int!
status: WorkSubmissionStatus!
executions: [Schedule!]!
```

## type NationalHoliday

```graphql
partitionKey: String!
date: LocalDate!
name: String!
id: String!
year: String!
```

## type NewPasskeyRequest

```graphql
id: UUID!  # Unique identifier for the passkey request
credentialCreateOptions: String!  # JSON-serialized WebAuthn credential creation options
```

## type NotificationTemplate

```graphql
usage: NotificationTemplateUsage!
id: UUID!
name: String!
template: String!
```

## type Organization

```graphql
id: String!
name: String!
kind: OrganizationKind!
settings: OrganizationSettings!
referral: OrganizationReferral
members(name: String from: String limit: Int): QueryResultOfMember!
member(id: String!): Member!
partners(name: String from: String limit: Int): QueryResultOfPartner!
works(name: String frequencies: [ScheduleFrequency!] statuses: [GenericEntityStatus!]): QueryResultOfWork!
work(id: String!): Work!
executionMonths: [ExecutionMonth!]!
executionMonth(year: Int! month: Int!): ExecutionMonth
monthlyWorkStatuses(year: Int! month: Int! showWithoutTodo: Boolean from: String count: Int): QueryResultOfMonthlyWorkStatus!
monthlyWorkStatus(id: String!): MonthlyWorkStatus!
assignment(id: String!): Assignment!
assignments(assignmentFrameIds: [String!] workId: String worker: WorkerRefInput from: String limit: Int): QueryResultOfAssignment!
worker(workerId: String! workerType: WorkerType!): IWorker
```

## type OrganizationLink

```graphql
id: String!
inviterOrganizationId: String!
accepterOrganizationId: String
status: OrganizationLinkStatus!
createdAt: DateTime!
expiresAt: DateTime!
establishedAt: DateTime
revokedAt: DateTime
isActive: Boolean!
```

## type OrganizationLinkInvitation

```graphql
token: String!
inviterOrganizationId: String!
inviterOrganizationName: String!
expiresAt: DateTime!
canBeAccepted: Boolean!
```

## type OrganizationLinkPayload

```graphql
link: OrganizationLink!
invitationUrl: String
```

## type OrganizationReferral

```graphql
invitationToken: String!
createdAt: DateTime!
```

## type OrganizationSettings

```graphql
notificationTemplate: [NotificationTemplate!]!
```

## type Partner

```graphql
id: String!
name: String!
status: GenericEntityStatus!
organizationLink: OrganizationLink
workDefinitionSharingSummary: PartnerWorkDefinitionSharingSummary!
```

## type PartnerPayload

```graphql
partner: Partner!
```

## type PartnerWorkDefinitionSharingSummary

```graphql
sharedWorkCount: Int!
pendingWorkCount: Int!
```

## type PasskeyIdentifier

```graphql
partitionKey: String!
type: IdentifierType!
value: String!
name: String!
credentialId: [Byte!]!
publicKey: [Byte!]!
signCount: Int!
credType: String!
aaGuid: UUID!
transports: [AuthenticatorTransport!]
isBackupEligible: Boolean!
isBackedUp: Boolean!
member: MemberReference!
createdAt: DateTime!
lastUsedAt: DateTime!
id: String!
```

## type PhotoPayload

```graphql
url: String!
```

## type ProductEntitlement

```graphql
productCode: ProductCode!
isUnlimited: Boolean!
```

## type QueryResultOfAbsence

```graphql
results: [Absence!]!
continuationToken: String
```

## type QueryResultOfApiKey

```graphql
results: [ApiKey!]!
continuationToken: String
```

## type QueryResultOfAssignment

```graphql
results: [Assignment!]!
continuationToken: String
```

## type QueryResultOfFacility

```graphql
results: [Facility!]!
continuationToken: String
```

## type QueryResultOfMagicLink

```graphql
results: [MagicLink!]!
continuationToken: String
```

## type QueryResultOfMember

```graphql
results: [Member!]!
continuationToken: String
```

## type QueryResultOfMeter

```graphql
results: [Meter!]!
continuationToken: String
```

## type QueryResultOfMonthlyWorkStatus

```graphql
results: [MonthlyWorkStatus!]!
continuationToken: String
```

## type QueryResultOfOrganization

```graphql
results: [Organization!]!
continuationToken: String
```

## type QueryResultOfPartner

```graphql
results: [Partner!]!
continuationToken: String
```

## type QueryResultOfWork

```graphql
results: [Work!]!
continuationToken: String
```

## type QueryResultOfWorkTagKey

```graphql
results: [WorkTagKey!]!
continuationToken: String
```

## type RegisterAbsencePayload

```graphql
absence: Absence!
```

## type RegisterNationalHolidaysPayload

```graphql
nationalHolidays: [NationalHoliday!]!
```

## type RegisterNewPasskeyPayload

```graphql
resultCode: RegisterNewPasskeyValidationResult!  # Result code indicating the outcome of the passkey registration
```

## type RemoveRolePayload

```graphql
memberRoleId: String!
```

## type RemoveSessionPayload

```graphql
removed: Boolean!
```

## type ResharePartnerWorkDefinitionsPayload

```graphql
sharedCount: Int!
failedCount: Int!
```

## type RevokeApiKeyPayload

```graphql
result: RevokeApiKeyResult!
apiKey: ApiKey
```

## type Role

```graphql
partitionKey: String!
matchesScope(scopeKey: String!): Boolean!
id: String!
name: String!
description: String!
scopePatterns: [String!]!
assignableByRoleIds: [String!]!
status: RoleStatus!
isInitial: Boolean!
createdAt: DateTime!
```

## type RolePayload

```graphql
role: Role!
```

## type SavedWorkFilter

```graphql
id: String!
target: SavedWorkFilterTarget!
name: String!
conditions: WorkFilterConditions!
createdAt: DateTime!
updatedAt: DateTime!
status: GenericEntityStatus!
reportTemplate: ScheduleReportTemplate
```

## type SavedWorkFilterPayload

```graphql
savedWorkFilter: SavedWorkFilter!
```

## type Schedule

```graphql
ymd: String!
date: LocalDate
yearMonth: YearMonth!
day: Int
timeFrames: [TimeFrame!]!
year: Int!
month: Int!
```

## type ScheduleConstraint

```graphql
months: [Int!]!
startDate: LocalDate!
endDate: LocalDate!
daysOfWeek: [DayOfWeekSpec!]!
daysOfMonth: [Int!]!
excludesNationalHolidays: Boolean!
timeFrames: [TimeFrame!]!
byYears: ByYearsConstraint!
```

## type ScheduleReportTemplate

```graphql
id: String!
savedFilterId: String!
blobPath: String!
originalFileName: String!
uploadedBy: String!
uploadedAt: DateTime!
status: ScheduleReportTemplateStatus!
updatedAt: DateTime
```

## type ScheduleReportTemplatePayload

```graphql
scheduleReportTemplate: ScheduleReportTemplate!
```

## type ScopeMetadata

```graphql
key: String!
description: String!
```

## type Session

```graphql
id: ID!
authenticationMethod: AuthenticationMethods!
accountRequirements: AccountRequirements!
identifierRequirements: IdentifierRequirement!
identifier: Identifier
member: Member
createdAt: DateTime!
organization: Organization
```

## type SetupFeeTerms

```graphql
priceId: String!
unitAmount: Int!
currency: String!
taxBehavior: String!
```

## type ShareWorkDefinitionPayload

```graphql
targetWorkId: String!
version: Int!
changed: Boolean!
```

## type SignInWithMagicLinkPayload

```graphql
result: SignInWithMagicLinkResult!
requiresAccountAssociation: Boolean!
```

## type SignInWithOtpPayload

```graphql
result: OtpValidationResult!
nextAttemptEnabledAt: DateTime
```

## type SignInWithPasskeyPayload

```graphql
resultCode: SignInWithPasskeyValidationResult!  # Result code indicating the outcome of the passkey sign-in
```

## type StartImpersonationPayload

```graphql
result: StartImpersonationResult!
impersonationSession: ImpersonationSession
session: Session
```

## type SubmitWorkMonthPayload

```graphql
results: [WorkSubmissionResult!]!
```

## type Subscription

```graphql
id: String!
organizationId: String!
stripeSubscriptionId: String!
productCode: ProductCode!
status: SubscriptionStatus!
quantity: Int!
currentPeriodEnd: DateTime!
cancelAtPeriodEnd: Boolean!
lastPaymentAt: DateTime
lastPaymentStatus: PaymentStatus
failureReason: String
setupFeeInvoiceItemId: String
```

## type TimeFrame

```graphql
from: Time!
to: Time!
totalMinutes: Int!
```

## type TodoItem

```graphql
severity: TodoSeverity!
code: String!
path: String
description: String!
```

## type UnregisterNationalHolidaysPayload

```graphql
date: LocalDate!
```

## type UpdateAbsencePayload

```graphql
absence: Absence!
```

## type UpdateAdjustmentPayload

```graphql
adjustment: ExecutionScheduleAdjustment!
```

## type UpdateMemberStatusPayload

```graphql
result: GenericUpdateStatusResult!
member: Member!
```

## type UpdatePartnerStatusPayload

```graphql
result: GenericUpdateStatusResult!
partner: Partner!
```

## type ValidationError

```graphql
path: String!
code: String!
```

## type WithdrawWorkSubmissionPayload

```graphql
workId: String!
version: Int!
changed: Boolean!
```

## type Work

```graphql
id: String!
name: String!
scheduleConstraint: ScheduleConstraint!
frequency: ScheduleFrequency!
allowFloatingTimeFrame: Boolean!
precautionsForResident: String
assignmentFrames: [AssignmentFrame!]!
origin: WorkOrigin
scheduledPersonMinutes: Int!
todos: [TodoItem!]!
hasTodos: Boolean!
status: GenericEntityStatus!
hasBeenDefinitionShared: Boolean!
hasUnsharedDefinitionChanges: Boolean!
hasRevokedDefinitionShare: Boolean!
clientPartner: Partner
contractorPartner: Partner
definitionSharingStatus(partnerId: String!): WorkDefinitionSharingStatus!
tags: [WorkTag!]!
```

## type WorkDefinitionSharingStatus

```graphql
hasBeenShared: Boolean!
hasChanges: Boolean!
version: Int
sharedAt: DateTime
isDetached: Boolean!
state: WorkSharingState!
```

## type WorkFilterConditions

```graphql
frequencies: [ScheduleFrequency!]!
workName: String
tagValues: [WorkTagValue!]!
isFulfilled: Boolean
statuses: [GenericEntityStatus!]!
```

## type WorkOrigin

```graphql
linkId: String!
organizationId: String!
workId: String!
version: Int!
sourcePartnerSlot: WorkPartnerSlot
displayName: String
isHidden: Boolean!
isLinkRevoked: Boolean!
sourcePartner: Partner
```

## type WorkPayload

```graphql
work: Work!
```

## type WorkQuotaUsage

```graphql
currentCount: Int!
limit: Int!
exceeded: Boolean!
isUnlimited: Boolean!
```

## type WorkSubmissionEntry

```graphql
workId: String!
workName: String!
role: WorkSubmissionRole!
hasSubmission: Boolean!
status: WorkSubmissionStatus
version: Int
submittedAt: DateTime
senderState: SenderWorkSubmissionState
isUnread: Boolean!
```

## type WorkSubmissionResult

```graphql
workId: String!
version: Int
status: WorkSubmissionResultStatus!
reason: String
```

## type WorkSubmissionsPayload

```graphql
entries: [WorkSubmissionEntry!]!
unreadCount: Int!
isMonthComplete: Boolean!
hasReceivedWork: Boolean!
```

## type WorkTag

```graphql
key: WorkTagKey!
value: WorkTagValue!
```

## type WorkTagAllowedValue

```graphql
id: String!
value: String!
displayName: String!
isRetired: Boolean!
```

## type WorkTagKey

```graphql
activeAllowedValues: [WorkTagAllowedValue!]!
isValueAllowed(value: String!): Boolean!
id: String!
key: String!
displayName: String!
valueType: WorkTagValueType!
allowedValues: [WorkTagAllowedValue!]!
description: String
status: GenericEntityStatus!
```

## type WorkTagKeyPayload

```graphql
workTagKey: WorkTagKey!
```

## type WorkTagValue

```graphql
tagKeyId: String!
value: String!
```

## type YearMonth

```graphql
year: Int!
month: Int!
dates: [LocalDate!]!
```

## input AcceptOrganizationLinkInput

```graphql
token: String!
partnerId: String
```

## input AdjustReceivedScheduleInput

```graphql
workId: String!
kind: ExecutionScheduleAdjustmentKind!
yearMonth: YearMonthInput!
adjustedSchedule: ScheduleInput
occurrenceIndex: Int
adjustmentId: String
```

## input ArchiveFacilityInput

```graphql
id: String!
lastReadingMonth: String!
```

## input ArchiveMeterInput

```graphql
id: String!
```

## input AssignRoleToMemberInput

```graphql
memberId: String!
roleId: String!
```

## input ByYearsConstraintInput

```graphql
interval: Int!
startYear: Int!
```

## input CancelAbsenceInput

```graphql
id: String!
```

## input CheckoutSessionInput

```graphql
productCode: ProductCode!
billingInterval: BillingInterval!
quantity: Int
successUrl: String!
cancelUrl: String!
```

## input ClearMeterValueInput

```graphql
meterId: String!
```

## input CreateAdjustmentInput

```graphql
year: Int!
month: Int!
day: Int
workId: String!
adjustedSchedule: ScheduleInput!
```

## input CreateApiKeyInput

```graphql
name: String!
```

## input CreateAssignmentFrameInput

```graphql
workId: String!
name: String!
minimumRequiredPersonMinutesByExecution: Int
minimumRequiredWorkersByExecution: Int
effectiveFrom: LocalDate
```

## input CreateAssignmentInput

```graphql
workId: String!
assignmentFrameId: String!
worker: WorkerRefInput!
scheduleConstraint: ScheduleConstraintInput
```

## input CreateExecutionMonthInput

```graphql
year: Int!
month: Int!
```

## input CreateFacilityInput

```graphql
name: String!
nameReading: String
```

## input CreateFeatureFlagInput

```graphql
key: String!
description: String!
isEnabled: Boolean!
enabledOrganizationIds: [String!]!
enabledRoleIds: [String!]!
```

## input CreateMagicLinkInput

```graphql
memberId: String!
accountRequirements: AccountRequirements
```

## input CreateMemberInput

```graphql
name: String!
managementNo: String
```

## input CreateMeterInput

```graphql
facilityId: String!
meterMonth: String!
meterName: String!
meterNo: String
nameReading: String
```

## input CreateOrganizationInput

```graphql
name: String!
memberName: String!
referralCode: String
```

## input CreatePartnerInput

```graphql
name: String!
```

## input CreateRoleInput

```graphql
name: String!
description: String!
scopePatterns: [String!]!
assignableByRoleIds: [String!]
isInitial: Boolean! = false
```

## input CreateSavedWorkFilterInput

```graphql
target: SavedWorkFilterTarget!
name: String!
conditions: WorkFilterConditionsInput!
```

## input CreateShareLinkInput

```graphql
facilityId: String!
meterMonth: String!
```

## input CreateWorkInput

```graphql
name: String
frequency: ScheduleFrequency!
scheduleConstraint: ScheduleConstraintInput
allowFloatingTimeFrame: Boolean
precautionsForResident: String
tags: [WorkTagValueInput!]
```

## input CreateWorkTagKeyAllowedValueInput

```graphql
value: String!
displayName: String!
```

## input CreateWorkTagKeyInput

```graphql
key: String!
displayName: String!
valueType: WorkTagValueType!
allowedValues: [CreateWorkTagKeyAllowedValueInput!]
description: String
```

## input CustomerPortalSessionInput

```graphql
returnUrl: String!
```

## input DayOfWeekSpecInput

```graphql
dayOfWeek: DayOfWeek!
occurrence: Int
```

## input DeleteAdjustmentInput

```graphql
id: String!
```

## input DeleteAssignmentFrameInput

```graphql
workId: String!
id: String!
effectiveUntil: LocalDate
```

## input DeleteAssignmentInput

```graphql
id: String!
```

## input DeleteExecutionMonthInput

```graphql
year: Int!
month: Int!
```

## input DeleteMagicLinkInput

```graphql
id: String!
```

## input DeleteMemberInput

```graphql
id: String!
```

## input DeletePartnerInput

```graphql
id: String!
```

## input DeleteWorkInput

```graphql
id: String!
```

## input DetachWorkInput

```graphql
workId: String!
```

## input GrantLifetimeLicenseRequestInput

```graphql
organizationId: String!
productCode: ProductCode!
note: String
```

## input InitializeMonthInput

```graphql
facilityId: String!
meterMonth: String!
force: Boolean!
```

## input InviteOrganizationLinkInput

```graphql
partnerId: String!
```

## input MarkWorkSubmissionsReadInput

```graphql
partnerId: String!
yearMonth: YearMonthInput!
```

## input NationalHolidayInput

```graphql
date: LocalDate!
name: String!
```

## input OtpSignInInput

```graphql
email: String!
product: Product!
```

## input RecordMeterValueInput

```graphql
meterId: String!
measureDate: String!
measureValue: Float
meterPhotoUrl: String
measureValueDecimalDigits: Int
```

## input RegisterAbsenceInput

```graphql
workerId: String!
workerType: WorkerType!
date: LocalDate!
timeFrame: TimeFrameInput!
```

## input RegisterNationalHolidaysInput

```graphql
nationalHolidays: [NationalHolidayInput!]!
```

## input RegisterNewPasskeyInput

```graphql
id: UUID!  # Unique identifier for the passkey request
attestationResponse: String!  # JSON-serialized WebAuthn attestation response from the client
```

## input RemoveRoleFromMemberInput

```graphql
memberId: String!
roleId: String!
```

## input ResharePartnerWorkDefinitionsInput

```graphql
partnerId: String!
```

## input RetireWorkTagKeyInput

```graphql
id: String!
```

## input RevokeApiKeyInput

```graphql
id: String!
```

## input RevokeLifetimeLicenseRequestInput

```graphql
organizationId: String!
productCode: ProductCode!
```

## input RevokeOrganizationLinkInput

```graphql
linkId: String!
```

## input ScheduleConstraintInput

```graphql
months: [Int!]
startDate: LocalDate
endDate: LocalDate
daysOfWeek: [DayOfWeekSpecInput!]
daysOfMonth: [Int!]
excludesNationalHolidays: Boolean
timeFrames: [TimeFrameInput!]
byYears: ByYearsConstraintInput
```

## input ScheduleInput

```graphql
date: LocalDate!
timeFrames: [TimeFrameInput!]!
```

## input SetWorkClientPartnerInput

```graphql
workId: String!
partnerId: String
```

## input SetWorkContractorPartnerInput

```graphql
workId: String!
partnerId: String
```

## input ShareWorkDefinitionInput

```graphql
workId: String!
partnerId: String!
```

## input SignInWithMagicLinkInput

```graphql
id: String!
```

## input SignInWithPasskeyInput

```graphql
challengeId: String!  # Unique identifier for the passkey sign-in challenge
authenticatorAssertionRawResponse: String!  # JSON-serialized WebAuthn assertion response from the client
```

## input SingInWithOtpInput

```graphql
id: String!
code: String!
```

## input StartOrganizationImpersonationInput

```graphql
targetOrganizationId: String!
```

## input SubmitWorkMonthInput

```graphql
partnerId: String!
yearMonth: YearMonthInput!
workIds: [String!]
```

## input TimeFrameInput

```graphql
from: Time!
to: Time!
```

## input UnarchiveFacilityInput

```graphql
id: String!
```

## input UnregisterNationalHolidaysInput

```graphql
date: LocalDate!
```

## input UpdateAbsenceInput

```graphql
id: String!
date: LocalDate
timeFrame: TimeFrameInput
```

## input UpdateAdjustmentInput

```graphql
id: String!
adjustedSchedule: ScheduleInput
```

## input UpdateAssignmentFrameInput

```graphql
workId: String!
id: String!
name: String
minimumRequiredPersonMinutesByExecution: Int
minimumRequiredWorkersByExecution: Int
```

## input UpdateAssignmentInput

```graphql
id: String!
organizationId: String!
workId: String!
assignmentFrameId: String!
worker: WorkerRefInput
scheduleConstraint: ScheduleConstraintInput
```

## input UpdateFacilityInput

```graphql
id: String!
name: String
nameReading: String
```

## input UpdateFeatureFlagInput

```graphql
featureFlagId: String!
isEnabled: Boolean
enabledOrganizationIds: [String!]
enabledRoleIds: [String!]
description: String
```

## input UpdateMemberInput

```graphql
id: String!
name: String
managementNo: String
```

## input UpdateMemberStatusInput

```graphql
id: String!
status: GenericEntityStatus!
```

## input UpdateMeterInput

```graphql
id: String!
meterName: String
meterNo: String
nameReading: String
```

## input UpdatePartnerInput

```graphql
id: String!
name: String!
```

## input UpdatePartnerStatusInput

```graphql
id: String!
status: GenericEntityStatus!
```

## input UpdateRoleInput

```graphql
roleId: String!
name: String
description: String
scopePatterns: [String!]
assignableByRoleIds: [String!]
status: RoleStatus
isInitial: Boolean
```

## input UpdateSavedWorkFilterInput

```graphql
id: String!
name: String
conditions: WorkFilterConditionsInput
```

## input UpdateWorkInput

```graphql
id: String!
name: String
frequency: ScheduleFrequency
scheduleConstraint: ScheduleConstraintInput
allowFloatingTimeFrame: Boolean
precautionsForResident: String
displayName: String
isHidden: Boolean
tags: [WorkTagValueInput!]
```

## input UpdateWorkStatusInput

```graphql
id: String!
status: GenericEntityStatus!
```

## input UpdateWorkTagKeyAllowedValueInput

```graphql
id: String
value: String!
displayName: String!
```

## input UpdateWorkTagKeyInput

```graphql
id: String!
displayName: String
description: String
allowedValues: [UpdateWorkTagKeyAllowedValueInput!]
```

## input UploadFacilityReportTemplateInput

```graphql
facilityId: String!
fileBase64: String!
originalFileName: String!
```

## input UploadPhotoInput

```graphql
photoBase64: String!
contentType: String!
fileName: String!
```

## input UploadScheduleReportTemplateInput

```graphql
savedFilterId: String!
fileBase64: String!
originalFileName: String!
```

## input WithdrawWorkSubmissionInput

```graphql
partnerId: String!
yearMonth: YearMonthInput!
workId: String!
```

## input WorkFilterConditionsInput

```graphql
frequencies: [ScheduleFrequency!]
workName: String
tagValues: [WorkTagValueInput!]
isFulfilled: Boolean
statuses: [GenericEntityStatus!]
```

## input WorkTagValueInput

```graphql
tagKeyId: String!
value: String!
```

## input WorkerRefInput

```graphql
id: String!
type: WorkerType!
```

## input YearMonthInput

```graphql
year: Int!
month: Int!
```

## enum AcceptOrganizationLinkResult

```graphql
SUCCESS
NOT_FOUND
EXPIRED
NOT_ACCEPTABLE
SELF_INVITATION
ALREADY_LINKED
```

## enum AccountRequirements

```graphql
REQUIRED
PREFERRED
OPTIONAL
PROHIBITED
```

## enum ApplyPolicy

```graphql
BEFORE_RESOLVER  # Before the resolver was executed.
AFTER_RESOLVER  # After the resolver was executed.
VALIDATION  # The policy is applied in the validation step before the execution.
```

## enum AssignmentFulfillmentStatus

```graphql
UNFULFILLED
FULFILLED
NOT_REQUIRED
```

## enum AuthenticationMethods

```graphql
ONE_TIME_PASS_CODE
PASSKEY
AUTHENTICATOR_APP
MAGIC_LINK
```

## enum AuthenticatorTransport

```graphql
USB
NFC
BLE
SMART_CARD
HYBRID
INTERNAL
```

## enum BillingInterval

```graphql
MONTHLY
YEARLY
```

## enum CreateOrganizationResult

```graphql
SUCCESS
```

## enum DayOfWeek

```graphql
SUNDAY
MONDAY
TUESDAY
WEDNESDAY
THURSDAY
FRIDAY
SATURDAY
```

## enum EndImpersonationResult

```graphql
SUCCESS
SESSION_NOT_FOUND
ALREADY_ENDED
```

## enum ExecutionMonthStatus

```graphql
INITIALIZING
INITIALIZED
```

## enum ExecutionOrigin

```graphql
OWN
RECEIVED
```

## enum ExecutionScheduleAdjustmentKind

```graphql
MOVE
CANCEL
ADD
```

## enum FacilityReportTemplateStatus

```graphql
ACTIVE
ARCHIVED
```

## enum GenericEntityStatus

```graphql
DRAFT
PUBLISHED
ARCHIVED
```

## enum GenericUpdateStatusResult

```graphql
SUCCESS
INVALID_TRANSITION
```

## enum IdentifierRequirementPriority

```graphql
REQUIRED
OPTIONAL
```

## enum IdentifierType

```graphql
EMAIL
PHONE
PASSKEY
```

## enum ImpersonationEndReason

```graphql
MANUAL
EXPIRED
SUPERSEDED
```

## enum InitiateOtpSignInStatus

```graphql
SUCCESS
IDENTIFIER_NOT_FOUND
NO_MEMBER_IN_SESSION
```

## enum NotificationTemplateUsage

```graphql
EMAIL
POSTING
```

## enum OrganizationKind

```graphql
CUSTOMER
SYSTEM
```

## enum OrganizationLinkStatus

```graphql
PENDING
ACTIVE
REVOKED
```

## enum OtpValidationResult

```graphql
SUCCESS
INVALID_CODE
CODE_EXPIRED
MAX_ATTEMPTS_EXCEEDED
ATTEMPT_INTERVAL_VIOLATION
USER_HOST_ADDRESS_MISMATCH
```

## enum PaymentStatus

```graphql
SUCCEEDED
FAILED
```

## enum Product

```graphql
PLATFORM
WORKS
METER_READING
```

## enum ProductCode

```graphql
METER_READING
WORKS
```

## enum RegisterNewPasskeyValidationResult

```graphql
SUCCEED
VALIDATION_FAILED
```

## enum RevokeApiKeyResult

```graphql
SUCCESS
NOT_FOUND
ALREADY_REVOKED
```

## enum RoleStatus

```graphql
ACTIVE
INACTIVE
```

## enum SavedWorkFilterTarget

```graphql
EXECUTION_SCHEDULE
WORK_LEDGER
```

## enum ScheduleFrequency

```graphql
MONTHLY
DAILY
YEARLY
```

## enum ScheduleReportTemplateStatus

```graphql
ACTIVE
ARCHIVED
```

## enum SenderWorkSubmissionState

```graphql
UNSUBMITTED
CURRENT
CHANGES_PENDING
SKIPPED
WITHDRAWN
```

## enum SignInWithMagicLinkResult

```graphql
SUCCESS
EXPIRED
```

## enum SignInWithPasskeyValidationResult

```graphql
SUCCEED
VALIDATION_FAILED
CHALLENGE_NOT_FOUND
CHALLENGE_EXPIRED
```

## enum StartImpersonationResult

```graphql
SUCCESS
TARGET_ORGANIZATION_NOT_FOUND
TARGET_ORGANIZATION_NOT_CUSTOMER
ALREADY_IMPERSONATING
```

## enum SubscriptionStatus

```graphql
ACTIVE
PAST_DUE
CANCELED
TRIALING
UNPAID
INCOMPLETE
INCOMPLETE_EXPIRED
PAUSED
```

## enum TodoSeverity

```graphql
INFO
WARNING
ERROR
```

## enum WorkPartnerSlot

```graphql
CLIENT
CONTRACTOR
```

## enum WorkSharingState

```graphql
NOT_SHARED
CURRENT
HAS_UNSHARED_CHANGES
DETACHED
ENDED
LINK_REVOKED
```

## enum WorkSubmissionResultStatus

```graphql
SUBMITTED
UNCHANGED
SKIPPED
```

## enum WorkSubmissionRole

```graphql
SENDER
RECEIVER
```

## enum WorkSubmissionStatus

```graphql
SUBMITTED
WITHDRAWN
```

## enum WorkTagValueType

```graphql
ENUM
TEXT
```

## enum WorkerType

```graphql
INTERNAL
OUTSOURCE
```

## union

```graphql
union IWorker = Member | Partner
```
