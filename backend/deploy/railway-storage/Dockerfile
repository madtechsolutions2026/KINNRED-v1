FROM rustfs/rustfs:1.0.4
USER root
RUN apk add --no-cache su-exec
COPY start.sh /kindred-storage-start.sh
RUN sed -i 's/\r$//' /kindred-storage-start.sh && chmod 755 /kindred-storage-start.sh
ENTRYPOINT ["/kindred-storage-start.sh"]
