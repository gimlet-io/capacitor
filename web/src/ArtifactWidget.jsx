import { format } from "date-fns";
import { TimeLabel } from './TimeLabel'

export function ArtifactWidget(props) {
  const { gitRepository } = props
  const artifact = gitRepository.status.artifact

  const revision = artifact.revision
  const hash = revision.slice(revision.indexOf(':') + 1);
  const url = gitRepository.spec.url.slice(gitRepository.spec.url.indexOf('@') + 1)
  const branch = gitRepository.spec.ref.branch

  const parsed = Date.parse(artifact.lastUpdateTime, "yyyy-MM-dd'T'HH:mm:ss");
  const exactDate = format(parsed, 'MMMM do yyyy, h:mm:ss a O')

  return (
    <>
      <div className="field font-medium text-neutral-700">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="h4 w-4 inline fill-current"><path d="M320 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm156.8-48C462 361 397.4 416 320 416s-142-55-156.8-128H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H163.2C178 151 242.6 96 320 96s142 55 156.8 128H608c17.7 0 32 14.3 32 32s-14.3 32-32 32H476.8z" /></svg>
        <span className="pl-1">
          <a href={`https://${url}/commit/${hash}`} target="_blank" rel="noopener noreferrer">
            {hash.slice(0, 8)} committed <TimeLabel title={exactDate} date={parsed} />
          </a>
        </span>
      </div>
      <span className="block field text-neutral-600">
        <span className='font-mono bg-gray-100 px-1 rounded'>{branch}</span>
        <span className='px-1'>@</span>
        <a href={`https://${url}`} target="_blank" rel="noopener noreferrer">{url}</a>
      </span>
    </>
  )
}
