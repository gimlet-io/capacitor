import React, { useState, useEffect } from 'react';
import { formatDistance } from "date-fns";

export function TimeLabel(props) {
  const { title, date } = props;
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
    <span title={title}>{label}</span>
  )
}
