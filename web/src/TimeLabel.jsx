import React, { useState, useEffect } from 'react';
import { formatDistance } from "date-fns";

export function TimeLabel(props) {
  const { title, date, className } = props;
  const [label, setLabel] = useState(formatDistance(date, new Date()));

  useEffect(() => {
    setLabel(formatDistance(date, new Date()));
  }, [date]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLabel(formatDistance(date, new Date()));
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [date]);

  return (
    <span className={className} title={title}> {label} ago</span>
  )
}
