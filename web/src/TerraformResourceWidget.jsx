import jp from "jsonpath";
import { format } from "date-fns";
import { TimeLabel } from "./TimeLabel";
import { NavigationButton } from "./NavigationButton";

export function TerraformResourceWidget(props) {
  const { tfRelease, withHistory, handleNavigationSelect } = props;

  const version = tfRelease.status.history
    ? tfRelease.status.history[0]
    : undefined;
  const appliedRevision = tfRelease.status.lastAppliedRevision;
  // const lastAttemptedRevision = tfRelease.status.lastAttemptedRevision

  const readyConditions = jp.query(
    tfRelease.status,
    '$..conditions[?(@.type=="Ready")]',
  );
  const readyCondition =
    readyConditions.length === 1 ? readyConditions[0] : undefined;
  const ready =
    readyConditions.length === 1 && readyConditions[0].status === "True";

  const readyTransitionTime = readyCondition
    ? readyCondition.lastTransitionTime
    : undefined;
  const parsed = Date.parse(readyTransitionTime, "yyyy-MM-dd'T'HH:mm:ss");
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
  const stalled = fiveMinutesAgo > parsed;

  const reconcilingConditions = jp.query(
    tfRelease.status,
    '$..conditions[?(@.type=="Reconciling")]',
  );
  const reconcilingCondition =
    reconcilingConditions.length === 1 ? reconcilingConditions[0] : undefined;
  const reconciling =
    reconcilingCondition && reconcilingConditions[0].status === "True";

  console.log("TF", tfRelease);
  const sourceRef = tfRelease.spec.sourceRef;
  const namespace = sourceRef.namespace
    ? sourceRef.namespace
    : tfRelease.metadata.namespace;
  const navigationHandler = () =>
    handleNavigationSelect(
      "Sources",
      namespace,
      sourceRef.name,
      sourceRef.kind,
    );

  return (
    <>
      {!ready && reconciling && !stalled && (
        <span>
          <span>Attempting: </span>
          <span>
            {tfRelease.spec.chart.spec.version}@
            {tfRelease.spec.chart.spec.chart}
          </span>
        </span>
      )}
      {!ready && stalled && (
        <span className="bg-orange-400">
          <span>Last Attempted: </span>
          {/* <span>{lastAttemptedRevision}@{version.chartName}</span> */}
          {/* <span>
            {tfRelease.spec.chart.spec.version}@
            {tfRelease.spec.chart.spec.chart}
          </span> */}
        </span>
      )}
      <span
        className={`block ${ready || reconciling ? "" : "font-normal text-neutral-600"} field`}
      >
        <span>Currently Installed: </span>
        <NavigationButton handleNavigation={navigationHandler}>
          {appliedRevision}@{version && version.chartName}
        </NavigationButton>
      </span>
      {withHistory && (
        <div className="pt-1 text-sm">
          {tfRelease.status.history &&
            tfRelease.status.history.map((release) => {
              const current = release.status === "deployed";

              let statusLabel = "";
              if (release.status === "deployed") {
                statusLabel = "was deployed";
              } else if (release.status === "superseded") {
                statusLabel = "was deployed";
              } else if (release.status === "failed") {
                statusLabel = "failed to deploy";
              }

              const deployTime = release.lastDeployed;
              const parsed = Date.parse(deployTime, "yyyy-MM-dd'T'HH:mm:ss");
              const exactDate = format(parsed, "MMMM do yyyy, h:mm:ss a O");

              return (
                <p
                  key={`${release.chartVersion}@${release.chartName}:${release.digest}`}
                  className={`${current ? "text-neutral-700" : "font-normal text-neutral-500"}`}
                >
                  <span>
                    {release.chartVersion}@{release.chartName}
                  </span>
                  <span className="pl-1">{statusLabel}</span>
                  <span className="pl-1">
                    <TimeLabel title={exactDate} date={parsed} /> ago
                  </span>
                  {release.status === "superseded" && (
                    <span>, now superseded</span>
                  )}
                </p>
              );
            })}
        </div>
      )}
    </>
  );
}
