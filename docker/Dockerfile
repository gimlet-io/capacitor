FROM --platform=$TARGETPLATFORM alpine:3

RUN addgroup -S capacitor && adduser -S capacitor -G capacitor

ADD docker/known_hosts /etc/ssh/ssh_known_hosts

RUN mkdir /var/lib/capacitor
RUN chown capacitor:capacitor /var/lib/capacitor
WORKDIR /capacitor

ARG TARGETPLATFORM
ARG BUILDPLATFORM

COPY --chown=capacitor:capacitor bin/${TARGETPLATFORM}/capacitor capacitor
COPY --chown=capacitor:capacitor web/build ./web/build/

USER capacitor

EXPOSE 9000
CMD ["/capacitor/capacitor"]
